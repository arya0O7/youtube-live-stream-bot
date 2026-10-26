#!/usr/bin/env python3
"""
Phoenix YouTube Bot — High-Speed Async Proxy Pre-Tester & Latency Benchmarker
Tests proxies concurrently, measures real round-trip latency (ms), verifies SSL,
and outputs verified low-latency proxies sorted to proxys.txt.
"""

import os
import sys
import time
import re
import argparse
import concurrent.futures
import urllib.request
import urllib.error
import urllib.parse
from typing import List, Dict, Optional, Callable

try:
    from colorama import init, Fore, Style
    init(autoreset=True)
except ImportError:
    class DummyColor:
        def __getattr__(self, name):
            return ""
    Fore = DummyColor()
    Style = DummyColor()

DEFAULT_TIMEOUT = 3.5
DEFAULT_WORKERS = 50
DEFAULT_TARGET = "https://www.youtube.com"

class ProxyTester:
    def __init__(self, target_url: str = DEFAULT_TARGET, timeout: float = DEFAULT_TIMEOUT):
        self.target_url = target_url
        self.timeout = timeout
        self.results: List[Dict] = []
        self.verified_proxies: List[Dict] = []
        self.is_running = False

    @staticmethod
    def clean_proxy(raw: str) -> Optional[str]:
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            return None
        match = re.search(r'(?:(?:https?|socks[45]):\/\/)?([a-zA-Z0-9_\-\.]+:[0-9]{2,5})', raw)
        if match:
            return match.group(1)
        return None

    def test_single_proxy(self, proxy_str: str) -> Dict:
        """
        Tests a single proxy against the target URL and measures latency in milliseconds.
        """
        clean = self.clean_proxy(proxy_str)
        if not clean:
            return {"proxy": proxy_str, "alive": False, "latency_ms": 9999, "error": "Invalid format"}

        formatted_proxy = f"http://{clean}"
        proxy_handler = urllib.request.ProxyHandler({
            "http": formatted_proxy,
            "https": formatted_proxy,
        })
        opener = urllib.request.build_opener(proxy_handler)
        opener.addheaders = [
            ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
            ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
            ("Accept-Language", "en-US,en;q=0.5")
        ]

        start_time = time.perf_counter()
        try:
            req = urllib.request.Request(self.target_url, headers=dict(opener.addheaders))
            with opener.open(req, timeout=self.timeout) as resp:
                elapsed_ms = round((time.perf_counter() - start_time) * 1000)
                status = resp.status if hasattr(resp, "status") else 200
                if 200 <= status < 400:
                    return {
                        "proxy": clean,
                        "alive": True,
                        "latency_ms": elapsed_ms,
                        "status_code": status,
                        "protocol": "HTTP/HTTPS",
                        "grade": "Fast" if elapsed_ms < 400 else ("Medium" if elapsed_ms < 900 else "Slow")
                    }
                return {"proxy": clean, "alive": False, "latency_ms": elapsed_ms, "error": f"HTTP {status}"}
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, Exception) as e:
            return {"proxy": clean, "alive": False, "latency_ms": 9999, "error": str(e)[:40]}

    def benchmark_list(
        self,
        proxy_list: List[str],
        max_workers: int = DEFAULT_WORKERS,
        target_working: int = 25,
        progress_callback: Optional[Callable[[Dict, int, int], None]] = None
    ) -> List[Dict]:
        """
        Benchmarks a list of proxies concurrently until target_working is met or list exhausted.
        """
        self.is_running = True
        self.results = []
        self.verified_proxies = []

        total = len(proxy_list)
        checked = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_proxy = {
                executor.submit(self.test_single_proxy, p): p for p in proxy_list
            }

            for future in concurrent.futures.as_completed(future_to_proxy):
                if not self.is_running:
                    executor.shutdown(wait=False, cancel_futures=True)
                    break

                res = future.result()
                checked += 1
                self.results.append(res)

                if res.get("alive"):
                    self.verified_proxies.append(res)
                    if progress_callback:
                        progress_callback(res, len(self.verified_proxies), target_working)
                    if len(self.verified_proxies) >= target_working:
                        executor.shutdown(wait=False, cancel_futures=True)
                        break

        # Sort verified proxies by lowest latency
        self.verified_proxies.sort(key=lambda x: x["latency_ms"])
        self.is_running = False
        return self.verified_proxies

    @staticmethod
    def scrape_from_sitios(sitios_file: str = "sitios.txt", max_sources: int = 20) -> List[str]:
        """Scrapes raw proxies from sitios.txt"""
        if not os.path.exists(sitios_file):
            return []

        with open(sitios_file, "r") as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]

        import random
        random.shuffle(urls)
        selected_urls = urls[:max_sources]

        scraped = set()
        headers = {"User-Agent": "Mozilla/5.0"}
        pattern = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b')

        for u in selected_urls:
            try:
                req = urllib.request.Request(u, headers=headers)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    text = resp.read().decode('utf-8', errors='ignore')
                    matches = pattern.findall(text)
                    for m in matches:
                        scraped.add(m)
                    if len(scraped) >= 500:
                        break
            except Exception:
                continue

        return list(scraped)

    def save_verified(self, output_file: str = "proxys.txt"):
        with open(output_file, "w") as f:
            for item in self.verified_proxies:
                f.write(f"{item['proxy']}\n")


def main():
    parser = argparse.ArgumentParser(description="Phoenix High-Speed Proxy Benchmark & Validator")
    parser.add_argument("--source", "-s", type=str, default="sitios.txt", help="Proxy source file or 'sitios.txt'")
    parser.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS, help="Concurrent workers")
    parser.add_argument("--timeout", "-t", type=float, default=DEFAULT_TIMEOUT, help="Timeout in seconds")
    parser.add_argument("--target", "-u", type=str, default=DEFAULT_TARGET, help="Target URL to test against")
    parser.add_argument("--limit", "-l", type=int, default=20, help="Stop after finding this many live proxies")
    parser.add_argument("--output", "-o", type=str, default="proxys.txt", help="Output file for verified proxies")
    args = parser.parse_args()

    print(f"\n{Fore.CYAN}{Style.BRIGHT}==================================================================")
    print(f"  ⚡ PHOENIX PROXY PRE-TESTER & LATENCY BENCHMARKER")
    print(f"  🎯 Target:  {args.target}")
    print(f"  👥 Workers: {args.workers} concurrent threads | Timeout: {args.timeout}s")
    print(f"  🎯 Goal:    {args.limit} verified live proxies")
    print(f"=================================================================={Style.RESET_ALL}\n")

    tester = ProxyTester(target_url=args.target, timeout=args.timeout)

    proxies_to_test = []
    if args.source == "sitios.txt" or not os.path.exists(args.source):
        print(f"{Fore.YELLOW}[*] Scraper initiated: fetching raw proxy candidates from sitios.txt...{Style.RESET_ALL}")
        proxies_to_test = tester.scrape_from_sitios("sitios.txt", max_sources=25)
        print(f"{Fore.CYAN}[*] Scraped {len(proxies_to_test)} unique candidates. Starting benchmark...{Style.RESET_ALL}\n")
    else:
        with open(args.source, "r") as f:
            proxies_to_test = [line.strip() for line in f if line.strip()]
        print(f"{Fore.CYAN}[*] Loaded {len(proxies_to_test)} candidates from {args.source}{Style.RESET_ALL}\n")

    if not proxies_to_test:
        print(f"{Fore.RED}[-] No candidate proxies found to test.{Style.RESET_ALL}")
        return

    def on_verified(result, count, target):
        color = Fore.GREEN if result["latency_ms"] < 400 else Fore.YELLOW
        print(f"  {color}✔ [{count}/{target}] {result['proxy']:<22} | Latency: {result['latency_ms']:>4}ms | Grade: {result['grade']}{Style.RESET_ALL}")

    verified = tester.benchmark_list(
        proxies_to_test,
        max_workers=args.workers,
        target_working=args.limit,
        progress_callback=on_verified
    )

    print(f"\n{Fore.CYAN}------------------------------------------------------------------")
    print(f"  BENCHMARK COMPLETE: Found {len(verified)} verified live proxies")
    print(f"------------------------------------------------------------------{Style.RESET_ALL}")

    if verified:
        tester.save_verified(args.output)
        print(f"{Fore.GREEN}✔ Sorted low-latency proxies saved to: {args.output}{Style.RESET_ALL}\n")
        print(f"{'Rank':<6}{'Proxy':<24}{'Latency':<12}{'Grade':<10}")
        print("-" * 52)
        for i, p in enumerate(verified[:10], 1):
            print(f"{i:<6}{p['proxy']:<24}{str(p['latency_ms'])+'ms':<12}{p['grade']:<10}")
        print()
    else:
        print(f"{Fore.RED}[-] Zero live proxies verified with {args.timeout}s timeout.{Style.RESET_ALL}\n")


if __name__ == "__main__":
    main()
