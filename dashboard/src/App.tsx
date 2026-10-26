import { useState, useEffect, useRef } from "react";
import {
  Play,
  Square,
  Flame,
  Globe,
  Sliders,
  Terminal,
  Cpu,
  Clock,
  Eye,
  Layers,
  ExternalLink,
  Clipboard,
  X,
  ShieldCheck,
  Zap,
  Server,
  RefreshCw,
  Activity,
  Radio,
  ArrowDownToLine,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LogEntry {
  id: number;
  time: string;
  text: string;
  level: "info" | "success" | "warning" | "danger" | "error";
}

interface StreamMetadata {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url: string;
  watch_url: string;
  is_live: boolean;
  views: number | null;
  live_viewers: number | null;
}

interface BenchmarkedProxy {
  proxy: string;
  alive: boolean;
  latency_ms: number;
  status_code: number;
  protocol: string;
  grade: "Fast" | "Medium" | "Slow";
}

interface BotStatus {
  status: "idle" | "starting" | "running" | "stopping";
  stream_id: string;
  active_windows: number;
  max_windows: number;
  botted: number;
  proxy_mode: string;
  proxy_count: number;
  headless: boolean;
  elapsed_seconds: number;
  cpu_percent: number;
  ram_mb: number;
  recent_logs: LogEntry[];
}

export default function App() {
  // Config state (Starts empty per user's strict requirement)
  const [streamInput, setStreamInput] = useState<string>("");
  const [windows, setWindows] = useState<number>(5);
  const [proxyMode, setProxyMode] = useState<string>("direct");
  const [customProxies, setCustomProxies] = useState<string>("");
  const [scrapeAmount, setScrapeAmount] = useState<string>("15");
  const [duration, setDuration] = useState<string>("0");
  const [headless, setHeadless] = useState<boolean>(false);

  // Live telemetry state
  const [status, setStatus] = useState<BotStatus>({
    status: "idle",
    stream_id: "",
    active_windows: 0,
    max_windows: 5,
    botted: 0,
    proxy_mode: "direct",
    proxy_count: 1,
    headless: false,
    elapsed_seconds: 0,
    cpu_percent: 0,
    ram_mb: 0,
    recent_logs: [],
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Inspector & Benchmark state
  const [streamInfo, setStreamInfo] = useState<StreamMetadata | null>(null);
  const [inspectingStream, setInspectingStream] = useState<boolean>(false);
  const [benchmarkedProxies, setBenchmarkedProxies] = useState<BenchmarkedProxy[]>([]);
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);

  // Parse 11-char YouTube ID
  const extractVideoId = (raw: string): string => {
    if (!raw || !raw.trim()) return "";
    const str = raw.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
      return str;
    }
    const match = str.match(/(?:v=|\/|be\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : "";
  };

  const currentVideoId = extractVideoId(streamInput);

  // Inspect stream when target changes
  useEffect(() => {
    if (!currentVideoId) {
      setStreamInfo(null);
      return;
    }
    let active = true;
    setInspectingStream(true);
    fetch(`/api/stream/inspect?id=${currentVideoId}`)
      .then((res) => res.json())
      .then((data) => {
        if (active && data.success) {
          setStreamInfo(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setInspectingStream(false);
      });
    return () => {
      active = false;
    };
  }, [currentVideoId]);

  // Sync benchmarked proxy table
  useEffect(() => {
    const fetchProxyTable = async () => {
      try {
        const res = await fetch("/api/proxy/table");
        if (res.ok) {
          const data = await res.json();
          setBenchmarkedProxies(data.proxies || []);
          setIsBenchmarking(data.is_running || false);
        }
      } catch (err) {}
    };
    fetchProxyTable();
    const interval = setInterval(fetchProxyTable, 2500);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Telemetry Poller & Log Sync
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("Status failed");
        const data: BotStatus = await res.json();
        setStatus(data);
        setIsBackendConnected(true);

        if (data.recent_logs && data.recent_logs.length > 0) {
          setLogs((prev) => {
            const existingIds = new Set(prev.map((l) => l.id));
            const newEntries = data.recent_logs.filter((l) => !existingIds.has(l.id));
            if (newEntries.length === 0) return prev;
            return [...prev, ...newEntries].slice(-150);
          });
        }
      } catch (err) {
        setIsBackendConnected(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  // SSE Real-Time Log Listener
  useEffect(() => {
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource("/api/logs/stream");
      evtSource.onmessage = (event) => {
        try {
          const entry: LogEntry = JSON.parse(event.data);
          setLogs((prev) => {
            if (prev.some((l) => l.id === entry.id)) return prev;
            return [...prev, entry].slice(-150);
          });
        } catch (e) {
          // ignore parse errors
        }
      };
      evtSource.onerror = () => {
        evtSource?.close();
      };
    } catch (e) {
      // EventSource unavailable
    }
    return () => {
      evtSource?.close();
    };
  }, []);

  // Format Elapsed Uptime
  const formatTime = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Launch Bot Action
  const handleStart = async () => {
    if (!currentVideoId) {
      addLocalLog("⚠️ Please enter or paste a valid YouTube Stream URL or Video ID first.", "warning");
      return;
    }

    addLocalLog(`🚀 Initiating launch: ID=${currentVideoId}, Windows=${windows}, Mode=${proxyMode}`, "info");

    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: currentVideoId,
          windows,
          proxy_mode: proxyMode,
          custom_proxies: customProxies,
          scrape_amount: parseInt(scrapeAmount, 10),
          duration: parseInt(duration, 10),
          headless,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        addLocalLog(`[-] Launch aborted: ${data.message}`, "danger");
      }
    } catch (err: any) {
      addLocalLog(`[-] Error communicating with server: ${err.message}`, "danger");
    }
  };

  // Stop Bot Action
  const handleStop = async () => {
    addLocalLog("🛑 Sending termination signal to all active Chrome workers...", "warning");
    try {
      await fetch("/api/stop", { method: "POST" });
    } catch (err: any) {
      addLocalLog(`[-] Error stopping bot: ${err.message}`, "danger");
    }
  };

  const addLocalLog = (text: string, level: LogEntry["level"]) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setLogs((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        time: timeStr,
        text,
        level,
      },
    ]);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setStreamInput(text.trim());
        addLocalLog("📋 Stream URL pasted from clipboard.", "info");
      }
    } catch {
      addLocalLog("Clipboard access denied. Please paste manually into the input box.", "warning");
    }
  };

  const handleRunBenchmark = async (limit = 15) => {
    setIsBenchmarking(true);
    addLocalLog(`⚡ Starting proxy benchmark scan (target: ${limit} live proxies)...`, "info");
    try {
      const res = await fetch("/api/proxy/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit, source: "sitios.txt" }),
      });
      const data = await res.json();
      if (!data.success) {
        addLocalLog(`Benchmark note: ${data.message}`, "warning");
      }
    } catch (e: any) {
      addLocalLog(`Failed to start benchmark: ${e.message}`, "danger");
      setIsBenchmarking(false);
    }
  };

  const handleUseProxy = (proxyStr: string) => {
    setCustomProxies((prev) => {
      const existing = prev ? prev.split("\n").map((p) => p.trim()) : [];
      if (!existing.includes(proxyStr)) {
        return existing.length > 0 ? `${prev}\n${proxyStr}` : proxyStr;
      }
      return prev;
    });
    setProxyMode("custom");
    addLocalLog(`✔ Added ${proxyStr} to Custom Proxy routing.`, "info");
  };

  const handleImportAllProxies = () => {
    if (benchmarkedProxies.length === 0) return;
    const text = benchmarkedProxies.map((p) => p.proxy).join("\n");
    setCustomProxies(text);
    setProxyMode("custom");
    addLocalLog(`✔ Imported ${benchmarkedProxies.length} verified low-latency proxies into Custom Routing!`, "success");
  };

  const isRunning = status.status === "running";
  const isStarting = status.status === "starting";
  const isStopping = status.status === "stopping";

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Top Ambient Glow Bar */}
      <div className="h-[2px] w-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-indigo-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />

      {/* Header Deck */}
      <header className="border-b border-slate-800/80 bg-[#0c1017]/90 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Flame className="h-5 w-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  PHOENIX BOT <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">v2.5 PRO</span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">YouTube Livestream View Engine & Session Orchestrator</p>
            </div>
          </div>

          {/* Engine Status Indicators */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
              <span className="text-slate-400">Backend:</span>
              <span className={`inline-flex items-center gap-1.5 font-medium ${isBackendConnected ? "text-emerald-400" : "text-amber-400"}`}>
                <span className={`h-2 w-2 rounded-full ${isBackendConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                {isBackendConnected ? "Connected" : "Standby / Local"}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Engine:</span>
              <Badge
                variant="outline"
                className={`uppercase tracking-wider font-semibold ${
                  isRunning
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-500/40 animate-pulse"
                    : isStarting
                    ? "bg-amber-950/60 text-amber-400 border-amber-500/40 animate-bounce"
                    : isStopping
                    ? "bg-rose-950/60 text-rose-400 border-rose-500/40"
                    : "bg-slate-800/60 text-slate-400 border-slate-700"
                }`}
              >
                {status.status}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Mission Controls (5 Cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Card 1: Target Stream (Starts Empty) */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-800/60 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                Target Livestream / Video
              </CardTitle>
              <Badge variant="outline" className="text-[10px] bg-slate-900/80 text-slate-400 border-slate-700">
                Auto-Parses ID
              </Badge>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="streamInput"
                    placeholder="Paste YouTube Stream URL or ID (e.g. TO6QzwRpPAQ)"
                    value={streamInput}
                    onChange={(e) => setStreamInput(e.target.value)}
                    className="bg-slate-950/80 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-emerald-500 font-mono text-xs pr-8"
                  />
                  {streamInput && (
                    <button
                      onClick={() => setStreamInput("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      title="Clear"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePasteClipboard}
                  className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-xs text-slate-300 flex items-center gap-1.5"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Paste
                </Button>
              </div>

              {/* Dynamic Video Preview Card - Stream Inspector */}
              {currentVideoId ? (
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row gap-3.5 transition-all animate-in fade-in duration-300">
                  <div className="relative h-20 w-32 rounded-lg overflow-hidden flex-shrink-0 bg-slate-900 border border-slate-800">
                    <img
                      src={streamInfo?.thumbnail_url || `https://img.youtube.com/vi/${currentVideoId}/hqdefault.jpg`}
                      alt="Thumbnail"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop";
                      }}
                    />
                    <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                      <div className="h-7 w-7 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">
                        <Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {streamInfo?.is_live ? (
                          <Badge className="bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[9px] px-1.5 py-0 flex items-center gap-1 animate-pulse">
                            <Radio className="h-2.5 w-2.5" /> LIVE BROADCAST
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-800/90 text-slate-300 border border-slate-700 text-[9px] px-1.5 py-0">
                            📹 RECORDED VIDEO
                          </Badge>
                        )}
                        <span className="font-mono text-xs text-emerald-400 font-semibold">{currentVideoId}</span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-100 line-clamp-1 mt-1">
                        {streamInfo?.title || (inspectingStream ? "Inspecting stream metadata..." : "YouTube Target Active")}
                      </h4>
                      {streamInfo?.author_name && (
                        <p className="text-[11px] text-slate-400 truncate">
                          Channel: <span className="text-cyan-400">{streamInfo.author_name}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-800/60 text-[11px]">
                      <span className="text-slate-400 font-mono">
                        {streamInfo?.live_viewers
                          ? `👥 ${streamInfo.live_viewers.toLocaleString()} watching`
                          : streamInfo?.views
                          ? `👁️ ${streamInfo.views.toLocaleString()} views`
                          : "Ready to stream"}
                      </span>
                      <a
                        href={`https://www.youtube.com/watch?v=${currentVideoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 underline"
                      >
                        Open <ExternalLink className="h-3 w-3 inline" />
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/30">
                  <p className="text-xs text-slate-500">No stream selected. Paste a YouTube link or ID above.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Concurrency & Windows */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl">
            <CardHeader className="pb-3 border-b border-slate-800/60 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Layers className="h-4 w-4 text-cyan-400" />
                Browser Concurrency
              </CardTitle>
              <Badge variant="secondary" className="bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-mono text-xs">
                {windows} Windows Active
              </Badge>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex justify-between items-center text-xs text-slate-400">
                <span>Parallel Chrome Workers</span>
                <span className="font-mono text-white font-semibold">{windows} instances</span>
              </div>
              <Slider
                value={[windows]}
                min={1}
                max={30}
                step={1}
                onValueChange={(vals) => setWindows(vals[0])}
                className="py-2"
              />

              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                {[1, 3, 5, 10, 20].map((num) => (
                  <Button
                    key={num}
                    variant="outline"
                    size="sm"
                    onClick={() => setWindows(num)}
                    className={`text-xs font-mono h-8 ${
                      windows === num
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {num}x
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Network & Proxy Mode */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl">
            <CardHeader className="pb-3 border-b border-slate-800/60">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Globe className="h-4 w-4 text-emerald-400" />
                Network & Proxy Routing
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <Tabs value={proxyMode} onValueChange={setProxyMode} className="w-full">
                <TabsList className="grid grid-cols-3 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <TabsTrigger value="direct" className="text-xs flex items-center gap-1.5 data-[state=active]:bg-emerald-950/60 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-500/40 border border-transparent">
                    <Zap className="h-3 w-3" /> Direct
                  </TabsTrigger>
                  <TabsTrigger value="scrape" className="text-xs flex items-center gap-1.5 data-[state=active]:bg-cyan-950/60 data-[state=active]:text-cyan-400 data-[state=active]:border-cyan-500/40 border border-transparent">
                    <Globe className="h-3 w-3" /> Scrape
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="text-xs flex items-center gap-1.5 data-[state=active]:bg-indigo-950/60 data-[state=active]:text-indigo-400 data-[state=active]:border-indigo-500/40 border border-transparent">
                    <Server className="h-3 w-3" /> Custom
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="direct" className="pt-3">
                  <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/20 text-xs text-slate-300 space-y-1">
                    <p className="font-semibold text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 inline" /> 100% Reliable & 0-Second Launch
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Launches instantly using session-isolated browser profiles. Eliminates slow public proxy timeouts. Reached 1,500+ views cleanly.
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="scrape" className="pt-3 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <Label className="text-slate-300">Verified Proxies Target:</Label>
                    <Select value={scrapeAmount} onValueChange={setScrapeAmount}>
                      <SelectTrigger className="w-36 h-8 text-xs bg-slate-950 border-slate-800">
                        <SelectValue placeholder="Target" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-800 text-xs">
                        <SelectItem value="15">15 Proxies (Fast)</SelectItem>
                        <SelectItem value="30">30 Proxies</SelectItem>
                        <SelectItem value="50">50 Proxies</SelectItem>
                        <SelectItem value="100">100 Proxies</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Scrapes 125+ verified proxy repositories from sitios.txt. Live progress will stream directly in the console.
                  </p>
                </TabsContent>

                <TabsContent value="custom" className="pt-3 space-y-2">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Paste Proxies (IP:PORT or user:pass@IP:PORT)</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {customProxies.split("\n").filter((p) => p.trim()).length} loaded
                    </Badge>
                  </div>
                  <Textarea
                    placeholder="185.199.229.156:8080&#10;user:pass@proxy.example.com:80"
                    rows={3}
                    value={customProxies}
                    onChange={(e) => setCustomProxies(e.target.value)}
                    className="bg-slate-950 border-slate-800 font-mono text-xs placeholder:text-slate-600"
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Card 4: Execution Options */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl">
            <CardHeader className="pb-3 border-b border-slate-800/60">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Sliders className="h-4 w-4 text-indigo-400" />
                Execution & Stealth
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold text-slate-200">Headless Chrome</Label>
                  <p className="text-[11px] text-slate-500">Runs invisibly in background, saves ~70% RAM</p>
                </div>
                <Switch checked={headless} onCheckedChange={setHeadless} />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                <div>
                  <Label className="text-xs font-semibold text-slate-200">Session Duration</Label>
                  <p className="text-[11px] text-slate-500">Watch time per browser session</p>
                </div>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="w-36 h-8 text-xs bg-slate-950 border-slate-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-xs">
                    <SelectItem value="0">Continuous / Infinite</SelectItem>
                    <SelectItem value="300">5 Minutes</SelectItem>
                    <SelectItem value="600">10 Minutes</SelectItem>
                    <SelectItem value="1800">30 Minutes</SelectItem>
                    <SelectItem value="3600">1 Hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Master Action Button */}
          <div>
            {!isRunning && !isStarting && !isStopping ? (
              <Button
                size="lg"
                onClick={handleStart}
                className="w-full h-12 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold tracking-wider shadow-lg shadow-emerald-500/25 transition-all text-sm flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4 fill-slate-950" />
                LAUNCH BOT SESSIONS NOW
              </Button>
            ) : isStarting ? (
              <Button
                size="lg"
                disabled
                className="w-full h-12 bg-amber-600/80 text-white font-bold tracking-wider text-sm flex items-center justify-center gap-2 cursor-wait"
              >
                <RefreshCw className="h-4 w-4 animate-spin" />
                INITIALIZING WORKERS...
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={handleStop}
                variant="destructive"
                className="w-full h-12 bg-rose-600 hover:bg-rose-500 text-white font-bold tracking-wider shadow-lg shadow-rose-600/25 transition-all text-sm flex items-center justify-center gap-2"
              >
                <Square className="h-4 w-4 fill-white" />
                STOP ALL BOT SESSIONS
              </Button>
            )}
          </div>
        </div>

        {/* Right Column: Telemetry Deck & Live Radar (7 Cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Metrics HUD: 4 Dynamic Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Metric 1: Botted count */}
            <Card className="bg-[#0e131d] border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <CardContent className="p-3.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Eye className="h-3 w-3 text-emerald-400" /> Views Delivered
                </span>
                <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                  {status.botted.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-500">Interaction cycles</span>
              </CardContent>
            </Card>

            {/* Metric 2: Active Windows */}
            <Card className="bg-[#0e131d] border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              <CardContent className="p-3.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="h-3 w-3 text-cyan-400" /> Active Windows
                </span>
                <div className="text-2xl font-bold font-mono text-cyan-400 mt-1">
                  {status.active_windows}
                  <span className="text-xs text-slate-500 font-normal ml-1">/ {status.max_windows || windows}</span>
                </div>
                <span className="text-[10px] text-slate-500">Live browser sessions</span>
              </CardContent>
            </Card>

            {/* Metric 3: Active Timer */}
            <Card className="bg-[#0e131d] border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              <CardContent className="p-3.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="h-3 w-3 text-indigo-400" /> Session Uptime
                </span>
                <div className="text-2xl font-bold font-mono text-indigo-400 mt-1">
                  {formatTime(status.elapsed_seconds)}
                </div>
                <span className="text-[10px] text-slate-500">Active streaming time</span>
              </CardContent>
            </Card>

            {/* Metric 4: Hardware Resources */}
            <Card className="bg-[#0e131d] border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
              <CardContent className="p-3.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-amber-400" /> System Load
                </span>
                <div className="text-2xl font-bold font-mono text-amber-400 mt-1">
                  {Math.round(status.cpu_percent)}%
                </div>
                <span className="text-[10px] text-slate-500">
                  {Math.round(status.ram_mb / 1024)} GB RAM Used
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Live Telemetry Terminal */}
          <Card className="bg-[#070a0f] border-slate-800/90 shadow-2xl flex flex-col h-[380px]">
            <CardHeader className="py-2.5 px-4 border-b border-slate-800 flex flex-row items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                  Live Telemetry Console
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  ({logs.length} events)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="text-[10px]">Auto-scroll</span>
                  <Switch
                    checked={autoScroll}
                    onCheckedChange={setAutoScroll}
                    className="scale-75"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLogs([])}
                  className="h-6 text-[10px] px-2 text-slate-400 hover:text-white"
                >
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 flex-1 overflow-y-auto font-mono text-xs space-y-1.5 bg-[#070a0f]">
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center py-10">
                  No telemetry events logged yet. Launch bot to start streaming events.
                </div>
              ) : (
                logs.map((log) => {
                  const isSuccess = log.level === "success" || log.text.includes("[+]");
                  const isWarn = log.level === "warning" || log.text.includes("[-]");
                  const isErr = log.level === "danger" || log.level === "error";

                  return (
                    <div
                      key={log.id}
                      className={`leading-relaxed break-all flex gap-2 items-start py-0.5 px-1 rounded ${
                        isSuccess
                          ? "text-emerald-400 bg-emerald-950/20"
                          : isWarn
                          ? "text-amber-300 bg-amber-950/20"
                          : isErr
                          ? "text-rose-400 bg-rose-950/20"
                          : "text-slate-300"
                      }`}
                    >
                      <span className="text-slate-600 flex-shrink-0 select-none text-[10px]">
                        [{log.time}]
                      </span>
                      <span className="flex-1 text-[11px]">{log.text}</span>
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </CardContent>
          </Card>

          {/* Worker Matrix Radar */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl">
            <CardHeader className="pb-3 border-b border-slate-800/60 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Activity className="h-4 w-4 text-emerald-400" />
                Worker Cluster Radar
              </CardTitle>
              <Badge variant="outline" className="text-[10px] font-mono text-slate-400">
                {status.active_windows} / {status.max_windows || windows} Online
              </Badge>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {Array.from({ length: status.max_windows || windows }).map((_, i) => {
                  const isActive = i < status.active_windows;
                  return (
                    <div
                      key={i}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        isActive
                          ? "bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                          : "bg-slate-950/40 border-slate-800/60 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isActive ? "bg-emerald-400 animate-ping" : "bg-slate-600"
                          }`}
                        />
                        <span className="text-[11px] font-mono font-bold text-slate-300">
                          W-{i + 1}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {isActive ? "Streaming" : "Standby"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Proxy Health & Latency Radar Table */}
          <Card className="bg-[#0e131d] border-slate-800/90 shadow-xl">
            <CardHeader className="pb-3 border-b border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                  <Globe className="h-4 w-4 text-cyan-400" />
                  Proxy Health & Latency Radar
                </CardTitle>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Pre-tested live proxies ranked by real round-trip ping to YouTube
                </p>
              </div>
              <div className="flex items-center gap-2">
                {benchmarkedProxies.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleImportAllProxies}
                    className="h-7 text-xs bg-slate-900 border-slate-800 text-emerald-400 hover:bg-slate-800 flex items-center gap-1"
                  >
                    <ArrowDownToLine className="h-3 w-3" />
                    Load All to Custom
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => handleRunBenchmark(15)}
                  disabled={isBenchmarking}
                  className="h-7 text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-medium flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3 w-3 ${isBenchmarking ? "animate-spin" : ""}`} />
                  {isBenchmarking ? "Benchmarking..." : "Run Benchmark"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              {benchmarkedProxies.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-slate-800 rounded-lg bg-slate-950/40">
                  <Globe className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 font-medium">No live benchmark data yet</p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                    Click "Run Benchmark" to scan candidates from 125+ sources and measure live round-trip latency.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <Table className="text-xs">
                    <TableHeader className="bg-slate-950/80">
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="w-12 text-slate-400">Rank</TableHead>
                        <TableHead className="text-slate-400">Proxy Endpoint</TableHead>
                        <TableHead className="text-slate-400">Protocol</TableHead>
                        <TableHead className="text-slate-400">Latency</TableHead>
                        <TableHead className="text-slate-400">Grade</TableHead>
                        <TableHead className="text-right text-slate-400">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {benchmarkedProxies.slice(0, 10).map((p, idx) => (
                        <TableRow key={idx} className="border-slate-800/60 hover:bg-slate-900/40">
                          <TableCell className="font-mono text-slate-500">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-slate-200 font-medium">
                            {p.proxy}
                          </TableCell>
                          <TableCell>
                            <span className="text-[10px] font-mono bg-slate-900 px-1.5 py-0.5 rounded text-slate-400 border border-slate-800">
                              {p.protocol || "HTTP"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`font-mono text-[10px] ${
                                p.latency_ms < 400
                                  ? "bg-emerald-950/60 text-emerald-400 border-emerald-500/40"
                                  : p.latency_ms < 900
                                  ? "bg-amber-950/60 text-amber-400 border-amber-500/40"
                                  : "bg-rose-950/60 text-rose-400 border-rose-500/40"
                              }`}
                            >
                              {p.latency_ms} ms
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[11px] font-medium ${
                                p.grade === "Fast"
                                  ? "text-emerald-400"
                                  : p.grade === "Medium"
                                  ? "text-amber-400"
                                  : "text-rose-400"
                              }`}
                            >
                              {p.grade}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUseProxy(p.proxy)}
                              className="h-6 text-[10px] text-cyan-400 hover:text-white hover:bg-slate-800 px-2"
                            >
                              Use
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
