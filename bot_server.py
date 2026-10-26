import os
import sys
import time
import json
import threading
import importlib.util
import webbrowser
import psutil
import logging
import urllib3
from flask import Flask, render_template, request, jsonify, Response

# Suppress SSL warnings and connection retry logs on shutdown
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
logging.getLogger("urllib3.util.retry").setLevel(logging.ERROR)
logging.getLogger("werkzeug").setLevel(logging.INFO)

# Setup directories
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(CURRENT_DIR, "web")
TEMPLATES_DIR = os.path.join(WEB_DIR, "templates")
STATIC_DIR = os.path.join(WEB_DIR, "static")

# Dynamically import YouTube-Livestream-bot.py (handles hyphens in filename)
bot_file = os.path.join(CURRENT_DIR, "YouTube-Livestream-bot.py")
spec = importlib.util.spec_from_file_location("youtube_bot_module", bot_file)
bot_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot_module)

YouTubeBot = bot_module.YouTubeBot
ProxyManager = bot_module.ProxyManager

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)

class BotController:
    def __init__(self):
        self.lock = threading.Lock()
        self.bot = None
        self.worker_threads = []
        self.status = "idle"  # "idle" | "starting" | "running" | "stopping"
        self.stream_id = ""
        self.windows = 5
        self.proxy_mode = "direct"  # "direct" | "scrape" | "custom"
        self.custom_proxies = ""
        self.scrape_amount = 200
        self.duration = 0
        self.headless = False
        self.start_time = 0
        self.logs = []
        self.log_counter = 0
        self.log_subscribers = []
        self.benchmarked_proxies = []
        self.benchmark_running = False

        self.add_log("System initialized. Phoenix YouTube Bot Control Deck ready.", "info")

    def add_log(self, message, level="info"):
        with self.lock:
            self.log_counter += 1
            timestamp = time.strftime("%H:%M:%S")
            entry = {
                "id": self.log_counter,
                "time": timestamp,
                "text": str(message),
                "level": level
            }
            self.logs.append(entry)
            if len(self.logs) > 300:
                self.logs.pop(0)

        # Notify active SSE subscribers
        data = f"data: {json.dumps(entry)}\n\n"
        for sub in list(self.log_subscribers):
            try:
                sub.put(data)
            except Exception:
                pass

    def get_stats(self):
        with self.lock:
            botted = self.bot.botted if self.bot else 0
            active_windows = self.bot.active_windows if self.bot else 0
            proxy_count = len(self.bot.proxy_manager.proxies) if (self.bot and self.bot.proxy_manager) else 0

        elapsed = 0
        if self.status == "running" and self.start_time > 0:
            elapsed = int(time.time() - self.start_time)

        # System resources
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        ram_mb = round((mem.total - mem.available) / (1024 * 1024), 1)

        return {
            "status": self.status,
            "stream_id": self.stream_id,
            "botted": botted,
            "active_windows": active_windows,
            "max_windows": self.windows,
            "proxy_mode": self.proxy_mode,
            "proxy_count": proxy_count,
            "headless": self.headless,
            "elapsed_seconds": elapsed,
            "cpu_percent": cpu,
            "ram_mb": ram_mb,
            "recent_logs": self.logs[-40:]
        }

    def start_bot(self, config):
        stream_input = config.get("stream", "").strip()
        if not stream_input:
            return False, "Please enter a YouTube video URL or Stream ID"

        with self.lock:
            if self.status in ["starting", "running"]:
                return False, "Bot is already running"
            self.status = "starting"

        def _runner():
            try:
                windows = max(1, min(int(config.get("windows", 3)), 50))
                proxy_mode = config.get("proxy_mode", "direct")
                custom_proxies = config.get("custom_proxies", "")
                scrape_amount = int(config.get("scrape_amount", 200))
                duration = int(config.get("duration", 0))
                headless = bool(config.get("headless", False))

                self.stream_id = stream_input
                self.windows = windows
                self.proxy_mode = proxy_mode
                self.custom_proxies = custom_proxies
                self.scrape_amount = scrape_amount
                self.duration = duration
                self.headless = headless

                self.add_log(f"Configuring session: Stream ID={stream_input}, Windows={windows}, Mode={proxy_mode}, Headless={headless}", "info")

                # Fresh reload of bot module
                bot_spec = importlib.util.spec_from_file_location("youtube_bot_module", bot_file)
                fresh_mod = importlib.util.module_from_spec(bot_spec)
                bot_spec.loader.exec_module(fresh_mod)
                FreshYouTubeBot = fresh_mod.YouTubeBot

                self.bot = FreshYouTubeBot(lang="en")
                self.bot.set_token(stream_input)
                self.bot.set_session_duration(duration)
                self.bot.max_windows = windows
                self.bot.headless = headless

                # Proxy Setup
                if proxy_mode == "direct":
                    self.bot.proxy_manager.proxies = ["direct"]
                    self.add_log("Network Mode: Direct Connection active (session-isolated local IP)", "success")
                elif proxy_mode == "custom" and custom_proxies.strip():
                    lines = [p.strip() for p in custom_proxies.splitlines() if p.strip()]
                    self.bot.proxy_manager.proxies = lines
                    self.add_log(f"Custom Proxies Loaded: {len(lines)} addresses configured", "success")
                elif proxy_mode == "scrape":
                    # Smart target: Don't make user wait for 300 proxies if they only run 10 windows
                    effective_target = min(scrape_amount, max(windows, 15))
                    self.add_log(f"Initiating fast proxy scrape: targeting {effective_target} verified proxies for {windows} windows...", "info")
                    sitios_path = os.path.join(CURRENT_DIR, "sitios.txt")
                    if os.path.exists(sitios_path):
                        def on_proxy_log(msg, lvl="info"):
                            self.add_log(msg, lvl)

                        success = self.bot.proxy_manager.load_proxies_from_file(
                            "sitios.txt", "en", effective_target, progress_callback=on_proxy_log
                        )
                        if not success or not self.bot.proxy_manager.proxies:
                            self.add_log("No responsive public proxies found. Falling back to Direct Mode.", "warning")
                            self.bot.proxy_manager.proxies = ["direct"]
                        else:
                            self.add_log(f"Scraped & Verified: {len(self.bot.proxy_manager.proxies)} working proxies ready!", "success")
                    else:
                        self.add_log("sitios.txt not found. Falling back to Direct Mode.", "warning")
                        self.bot.proxy_manager.proxies = ["direct"]
                else:
                    self.bot.proxy_manager.proxies = ["direct"]

                with self.lock:
                    if not self.bot.running or self.status in ["stopping", "idle"]:
                        self.add_log("Session start cancelled by stop command.", "warning")
                        self.status = "idle"
                        return
                    self.start_time = time.time()
                    self.status = "running"

                self.add_log(f"🚀 Spawning {windows} concurrent Chrome worker instances...", "success")

                # Hook logs from bot.printing
                def _log_poller():
                    last_len = 0
                    while self.status == "running" and self.bot and self.bot.running:
                        time.sleep(0.5)
                        if self.bot and self.bot.printing:
                            curr_len = len(self.bot.printing)
                            if curr_len > last_len:
                                new_items = self.bot.printing[last_len:curr_len]
                                for item in new_items:
                                    clean_text = str(item)
                                    # Strip ansi colors
                                    import re
                                    clean_text = re.sub(r'\x1b\[[0-9;]*m', '', clean_text).strip()
                                    level = "success" if "[+]" in clean_text else ("danger" if "[-]" in clean_text else "info")
                                    self.add_log(clean_text, level)
                                last_len = curr_len

                threading.Thread(target=_log_poller, daemon=True).start()

                # Launch worker threads
                self.worker_threads = []
                for i in range(windows):
                    t = threading.Thread(target=self.bot.bot, daemon=True, name=f"Worker-{i+1}")
                    t.start()
                    self.worker_threads.append(t)

                self.add_log(f"All {windows} workers active and streaming.", "success")

            except Exception as e:
                self.status = "idle"
                self.add_log(f"Fatal error starting bot: {str(e)}", "danger")

        threading.Thread(target=_runner, daemon=True).start()
        return True, "Bot launch initiated"

    def stop_bot(self):
        with self.lock:
            if self.status != "running" and self.status != "starting":
                return False, "Bot is not running"
            self.status = "stopping"

        self.add_log("🛑 Stop command received. Terminating all Chrome instances...", "warning")

        def _stopper():
            try:
                if self.bot:
                    self.bot.stop()
                time.sleep(1)
                with self.lock:
                    self.status = "idle"
                self.add_log("Bot stopped. All browser sessions safely closed.", "info")
            except Exception as e:
                with self.lock:
                    self.status = "idle"
                self.add_log(f"Error while stopping bot: {str(e)}", "danger")

        threading.Thread(target=_stopper, daemon=True).start()
        return True, "Stopping bot"

    def start_proxy_benchmark(self, limit=15, source="sitios.txt"):
        if self.benchmark_running:
            return False, "Benchmark is already running"

        self.benchmark_running = True
        self.add_log(f"⚡ Launching high-speed proxy benchmark (target: {limit} live proxies)...", "info")

        def _worker():
            try:
                from proxy_tester import ProxyTester
                tester = ProxyTester(timeout=3.0)
                candidates = []
                if os.path.exists(source):
                    if source == "sitios.txt":
                        candidates = tester.scrape_from_sitios(source, max_sources=15)
                    else:
                        with open(source, "r") as f:
                            candidates = [line.strip() for line in f if line.strip()]

                if not candidates:
                    candidates = tester.scrape_from_sitios("sitios.txt", max_sources=15)

                self.add_log(f"Testing {len(candidates)} proxy candidates concurrently...", "info")

                def _on_v(res, count, target):
                    self.add_log(f"✔ Live Proxy: {res['proxy']} ({res['latency_ms']}ms, {res['grade']})", "success")

                verified = tester.benchmark_list(candidates, max_workers=40, target_working=limit, progress_callback=_on_v)
                with self.lock:
                    self.benchmarked_proxies = verified
                    self.benchmark_running = False

                self.add_log(f"🎉 Proxy benchmark completed! {len(verified)} verified live proxies ready.", "success")
                if verified:
                    tester.save_verified("proxys.txt")
            except Exception as e:
                with self.lock:
                    self.benchmark_running = False
                self.add_log(f"Proxy benchmark error: {str(e)}", "danger")

        threading.Thread(target=_worker, daemon=True).start()
        return True, "Benchmark initiated"

def inspect_youtube_stream(video_id: str) -> dict:
    info = {
        "success": True,
        "video_id": video_id,
        "title": f"YouTube Video ({video_id})",
        "author_name": "YouTube Creator",
        "author_url": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
        "watch_url": f"https://www.youtube.com/watch?v={video_id}",
        "is_live": False,
        "views": None,
        "live_viewers": None
    }
    # 1. Fetch official oEmbed data
    try:
        import urllib.request
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode())
            info["title"] = data.get("title", info["title"])
            info["author_name"] = data.get("author_name", info["author_name"])
            info["author_url"] = data.get("author_url", info["author_url"])
            if data.get("thumbnail_url"):
                info["thumbnail_url"] = data.get("thumbnail_url")
    except Exception:
        pass

    # 2. Check live status and public viewer counters
    try:
        import urllib.request
        import re
        watch_url = f"https://www.youtube.com/watch?v={video_id}"
        req = urllib.request.Request(watch_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        })
        with urllib.request.urlopen(req, timeout=4) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            info["is_live"] = ('isLiveBroadcast' in html) or ('"isLive":true' in html) or ('"liveStreamability"' in html)
            view_match = re.search(r'"viewCount":\s*"(\d+)"', html)
            if view_match:
                info["views"] = int(view_match.group(1))
            live_match = re.search(r'"concurrentViewers":\s*"(\d+)"', html)
            if live_match:
                info["live_viewers"] = int(live_match.group(1))
    except Exception:
        pass

    return info

controller = BotController()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify(controller.get_stats())

@app.route("/api/start", methods=["POST"])
def api_start():
    data = request.get_json() or {}
    success, msg = controller.start_bot(data)
    return jsonify({"success": success, "message": msg})

@app.route("/api/stop", methods=["POST"])
def api_stop():
    success, msg = controller.stop_bot()
    return jsonify({"success": success, "message": msg})

@app.route("/api/video-info", methods=["GET"])
def api_video_info():
    raw = request.args.get("id", "").strip()
    import re
    match = re.search(r'(?:v=|\/|be\/|shorts\/)([a-zA-Z0-9_-]{11})', raw)
    video_id = match.group(1) if match else raw
    if not video_id:
        video_id = "dQw4w9WgXcQ"
    return jsonify(inspect_youtube_stream(video_id))

@app.route("/api/stream/inspect", methods=["GET"])
def api_stream_inspect():
    raw = request.args.get("id", "").strip()
    import re
    match = re.search(r'(?:v=|\/|be\/|shorts\/)([a-zA-Z0-9_-]{11})', raw)
    video_id = match.group(1) if match else raw
    if not video_id:
        video_id = "dQw4w9WgXcQ"
    return jsonify(inspect_youtube_stream(video_id))

@app.route("/api/proxy/benchmark", methods=["POST"])
def api_proxy_benchmark():
    data = request.get_json() or {}
    limit = int(data.get("limit", 15))
    source = data.get("source", "sitios.txt")
    success, msg = controller.start_proxy_benchmark(limit=limit, source=source)
    return jsonify({"success": success, "message": msg})

@app.route("/api/proxy/table", methods=["GET"])
def api_proxy_table():
    with controller.lock:
        return jsonify({
            "proxies": controller.benchmarked_proxies,
            "is_running": controller.benchmark_running,
            "count": len(controller.benchmarked_proxies)
        })

@app.route("/api/logs/stream")
def api_logs_stream():
    import queue
    q = queue.Queue()
    controller.log_subscribers.append(q)

    def event_generator():
        try:
            # Send initial greeting
            yield f"data: {json.dumps({'id': 0, 'time': time.strftime('%H:%M:%S'), 'text': 'Live telemetry stream connected.', 'level': 'info'})}\n\n"
            while True:
                msg = q.get()
                yield msg
        except GeneratorExit:
            if q in controller.log_subscribers:
                controller.log_subscribers.remove(q)

    return Response(event_generator(), mimetype="text/event-stream")

def start_server(port=5050, auto_open=True):
    print("=" * 64)
    print("  🔥 PHOENIX YOUTUBE BOT — WEB CONTROL PANEL")
    print(f"  🌐 Control Deck: http://localhost:{port}")
    print("=" * 64)

    if auto_open:
        def _open():
            time.sleep(1.0)
            webbrowser.open(f"http://localhost:{port}")
        threading.Thread(target=_open, daemon=True).start()

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    start_server(port=port, auto_open=True)
