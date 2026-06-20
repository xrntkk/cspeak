import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, AreaSeries, CandlestickSeries } from "lightweight-charts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  marketBroadIndex,
  marketCatalogue,
  marketItemKline,
  marketList,
  marketPriceSingle,
  type BroadIndex,
  type Candle,
  type CatalogueItem,
  type MarketListItem,
  type PlatformPrice,
} from "@/lib/market";

const KLINE_TYPES = [
  { label: "日K", value: "1" },
  { label: "周K", value: "2" },
  { label: "月K", value: "3" },
];

const CAT_KEY = "csspeak.market.catalogue";
const CAT_TS_KEY = "csspeak.market.catalogue.ts";
const CAT_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

/// A unified shape the detail view can open: either a hot-list item (with
/// prices already) or a catalogue search hit (prices fetched on demand).
interface DetailTarget {
  marketHashName: string;
  shortName: string;
  name: string;
  imageUrl?: string;
  rarityColor?: string;
  prices?: PlatformPrice[];
}

export function MarketPanel({ dark }: { dark: boolean }) {
  const [index, setIndex] = useState<BroadIndex | null>(null);
  const [hot, setHot] = useState<MarketListItem[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DetailTarget | null>(null);

  // Big-board index: fetch once.
  useEffect(() => {
    marketBroadIndex().then(setIndex).catch(() => {});
  }, []);

  // Hot list (rich cards with prices/images) as the default view.
  useEffect(() => {
    marketList(1, 100, "")
      .then((page) => setHot(page.list))
      .catch(() => {})
      .finally(() => setHotLoading(false));
  }, []);

  // Full catalogue from the Worker (cached 24h) — loaded for search.
  useEffect(() => {
    try {
      const ts = Number(localStorage.getItem(CAT_TS_KEY) || 0);
      const cached = localStorage.getItem(CAT_KEY);
      if (cached && Date.now() - ts < CAT_MAX_AGE) {
        setCatalogue(JSON.parse(cached));
        return;
      }
    } catch {
      /* ignore */
    }
    marketCatalogue()
      .then((items) => {
        setCatalogue(items);
        try {
          localStorage.setItem(CAT_KEY, JSON.stringify(items));
          localStorage.setItem(CAT_TS_KEY, String(Date.now()));
        } catch {
          /* quota */
        }
      })
      .catch(() => {});
  }, []);

  const q = query.trim().toLowerCase();

  // Search hits over the full catalogue (capped for rendering).
  const searchHits = useMemo(() => {
    if (!q) return [];
    return catalogue
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.marketHashName.toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [q, catalogue]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {index && <BroadIndexCard index={index} dark={dark} />}

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            catalogue.length
              ? `搜索全部 ${catalogue.length} 件饰品…`
              : "搜索饰品名称…"
          }
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
        />
      </div>

      {q ? (
        // Search results from the full catalogue.
        searchHits.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {catalogue.length ? "无匹配饰品" : "饰品库加载中,稍后重试…"}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {searchHits.map((it) => (
              <button
                key={it.marketHashName}
                onClick={() =>
                  setSelected({
                    marketHashName: it.marketHashName,
                    shortName: it.name,
                    name: it.marketHashName,
                  })
                }
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:border-ring"
              >
                <span>{it.name}</span>
                <span className="text-xs text-muted-foreground">
                  {it.platformList?.length ?? 0} 平台
                </span>
              </button>
            ))}
          </div>
        )
      ) : hotLoading ? (
        <div className="text-sm text-muted-foreground">加载中…</div>
      ) : (
        // Default hot list.
        <>
          <div className="text-xs font-medium uppercase text-muted-foreground">
            热门饰品
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {hot.map((it) => (
              <ItemCard
                key={it.itemId}
                item={it}
                onClick={() =>
                  setSelected({
                    marketHashName: it.marketHashName,
                    shortName: it.shortName,
                    name: it.name,
                    imageUrl: it.imageUrl,
                    rarityColor: it.rarityColor,
                    prices: it.prices,
                  })
                }
              />
            ))}
          </div>
        </>
      )}

      {selected && (
        <ItemDetail target={selected} dark={dark} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function chartColors(dark: boolean) {
  return {
    layout: {
      background: { color: "transparent" },
      textColor: dark ? "#a1a1a1" : "#737373",
    },
    grid: {
      vertLines: { color: dark ? "#262626" : "#e5e5e5" },
      horzLines: { color: dark ? "#262626" : "#e5e5e5" },
    },
    rightPriceScale: { borderColor: dark ? "#262626" : "#e5e5e5" },
    timeScale: { borderColor: dark ? "#262626" : "#e5e5e5" },
  };
}

function BroadIndexCard({ index, dark }: { index: BroadIndex; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const up = index.diffYesterday >= 0;

  useEffect(() => {
    if (!ref.current || index.history.length === 0) return;
    const chart = createChart(ref.current, {
      ...chartColors(dark),
      height: 160,
      autoSize: true,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: up ? "#22c55e" : "#ef4444",
      topColor: up ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      bottomColor: "transparent",
      priceLineVisible: false,
    });
    series.setData(
      index.history.map(([t, v]) => ({ time: t as never, value: v })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [index, dark, up]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-muted-foreground">大盘指数</span>
        <span className="text-2xl font-semibold">{index.index.toFixed(2)}</span>
        <span
          className={cn(
            "flex items-center gap-1 text-sm",
            up ? "text-green-500" : "text-red-500",
          )}
        >
          {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          {up ? "+" : ""}
          {index.diffYesterday.toFixed(2)} ({(index.diffRatio).toFixed(2)}%)
        </span>
      </div>
      <div ref={ref} className="mt-2" />
    </div>
  );
}

function ItemCard({ item, onClick }: { item: MarketListItem; onClick: () => void }) {
  const valid = item.prices.filter((p) => p.sellPrice > 0).sort((a, b) => a.sellPrice - b.sellPrice);
  const lowest = valid[0];
  const highest = valid[valid.length - 1];
  // Cross-platform spread: profit margin buying at lowest, selling at highest.
  const spread =
    lowest && highest && highest.sellPrice > lowest.sellPrice
      ? ((highest.sellPrice - lowest.sellPrice) / lowest.sellPrice) * 100
      : 0;
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="flex items-center gap-2">
        <img src={item.imageUrl} alt="" className="size-12 object-contain" />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-medium"
            style={{ color: item.rarityColor }}
          >
            {item.shortName}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {item.exteriorName}
          </div>
        </div>
      </div>
      {lowest && (
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">
            {lowest.platform}最低
          </span>
          <span className="text-sm font-semibold">¥{lowest.sellPrice.toFixed(2)}</span>
        </div>
      )}
      {spread > 0 && (
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">
            {lowest.platform}→{highest.platform} 价差
          </span>
          <span className={cn(spread >= 5 ? "text-green-500" : "text-muted-foreground")}>
            +{spread.toFixed(1)}%
          </span>
        </div>
      )}
    </button>
  );
}

function ItemDetail({
  target,
  dark,
  onClose,
}: {
  target: DetailTarget;
  dark: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [klineType, setKlineType] = useState("1");
  const [platform, setPlatform] = useState("YOUPIN");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  // Prices: use the ones passed in (hot list) or fetch on demand (search hit).
  const [prices, setPrices] = useState<PlatformPrice[]>(target.prices ?? []);

  useEffect(() => {
    if (target.prices && target.prices.length) return;
    marketPriceSingle(target.marketHashName)
      .then(setPrices)
      .catch(() => setPrices([]));
  }, [target.marketHashName, target.prices]);

  useEffect(() => {
    setLoading(true);
    marketItemKline(target.marketHashName, platform, klineType)
      .then(setCandles)
      .catch(() => setCandles([]))
      .finally(() => setLoading(false));
  }, [target.marketHashName, platform, klineType]);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const chart = createChart(ref.current, {
      ...chartColors(dark),
      height: 320,
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    series.setData(
      candles.map((c) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, dark]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-full w-[680px] flex-col rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-3">
          {target.imageUrl && (
            <img src={target.imageUrl} alt="" className="size-12 object-contain" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold" style={{ color: target.rarityColor }}>
              {target.shortName}
            </div>
            <div className="text-xs text-muted-foreground">{target.marketHashName}</div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Multi-platform price comparison */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {prices.filter((p) => p.sellPrice > 0).length === 0 ? (
            <div className="col-span-full text-xs text-muted-foreground">
              加载价格中…
            </div>
          ) : (
            prices
              .filter((p) => p.sellPrice > 0)
              .map((p) => (
                <div
                  key={p.platform}
                  className="rounded-md border border-border px-2 py-1.5"
                >
                  <div className="text-xs text-muted-foreground">{p.platform}</div>
                  <div className="text-sm font-semibold">¥{p.sellPrice.toFixed(2)}</div>
                </div>
              ))
          )}
        </div>

        {/* Kline controls */}
        <div className="mb-2 flex gap-1">
          {KLINE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setKlineType(t.value)}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                klineType === t.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t.label}
            </button>
          ))}
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {["YOUPIN", "BUFF", "C5", "STEAM"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            加载K线…
          </div>
        ) : candles.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            该平台暂无K线数据
          </div>
        ) : (
          <div ref={ref} />
        )}
      </div>
    </div>
  );
}
