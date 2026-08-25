'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, FvgZone, LiquidityLevel, SessionOccurrence, StructureEvent, Timeframe } from '@xau/core';
import { filterCleanFvgs, filterCleanLevels, consolidateFvgZones, averageRange } from '@xau/core';

/**
 * The chart.
 *
 * Overlays are drawn in a layer above the canvas rather than as chart
 * primitives, because FVG zones and session bands need to be visually
 * distinct in ways price lines cannot express — a dead FVG must look dead.
 */

export interface TradeOverlay {
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  label?: string;
}

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'circle' | 'arrowUp' | 'arrowDown' | 'square';
  text: string;
}

export interface TradingChartProps {
  candles: Candle[];
  timeframe: Timeframe;
  timezone: string;
  pricePrecision?: number;
  fvgZones?: FvgZone[];
  liquidity?: LiquidityLevel[];
  sessions?: SessionOccurrence[];
  markers?: ChartMarker[];
  structureEvents?: StructureEvent[];
  trade?: TradeOverlay | null;
  /** Active setup FVG ID to display exclusively in Setup Only mode */
  activeSetupFvgId?: string | null;
  /** Active setup liquidity level ID to display exclusively in Setup Only mode */
  activeSetupLiquidityId?: string | null;
  showVolume?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  height?: number | string;
  /** Called with the price the user clicked, for placing levels from the chart. */
  onPriceClick?: (price: number, time: number) => void;
}

const UP = '#22c55e';
const DOWN = '#ef4444';

export type ChartPreset = 'setup_only' | 'focus' | 'balanced' | 'pro' | 'custom';

export interface ChartLayerSettings {
  preset: ChartPreset;
  setupOnlyMode: boolean;
  showStructure: boolean;
  showFvg: boolean;
  fvgMaxCount: number;
  fvgHideMitigated: boolean;
  fvgMaxDistanceAtr: number;
  showLiquidity: boolean;
  showLiquidityBadges: boolean;
  liquidityIntactOnly: boolean;
  liquidityMaxCount: number;
  showSessions: boolean;
  showTrade: boolean;
  showVolume: boolean;
}

const DEFAULT_LAYER_SETTINGS: ChartLayerSettings = {
  preset: 'setup_only',
  setupOnlyMode: true,
  showStructure: true,
  showFvg: true,
  fvgMaxCount: 3,
  fvgHideMitigated: true,
  fvgMaxDistanceAtr: 3,
  showLiquidity: true,
  showLiquidityBadges: true,
  liquidityIntactOnly: true,
  liquidityMaxCount: 6,
  showSessions: true,
  showTrade: true,
  showVolume: true,
};

export function TradingChart({
  candles,
  timeframe,
  timezone,
  pricePrecision = 2,
  fvgZones = [],
  liquidity = [],
  sessions = [],
  markers = [],
  structureEvents = [],
  trade = null,
  activeSetupFvgId = null,
  activeSetupLiquidityId = null,
  showVolume = true,
  height = 480,
  onPriceClick,
}: TradingChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const drawOverlayRef = useRef<() => void>(() => {});
  const popoverRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [layers, setLayers] = useState<ChartLayerSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_LAYER_SETTINGS;
    try {
      const saved = localStorage.getItem('xau_chart_layers_config_v2');
      if (saved) return { ...DEFAULT_LAYER_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // fallback
    }
    return DEFAULT_LAYER_SETTINGS;
  });

  const updateLayers = (updates: Partial<ChartLayerSettings>) => {
    setLayers((prev) => {
      const next = { ...prev, ...updates };
      if (!updates.preset) next.preset = 'custom';
      try {
        localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const applyPreset = (preset: ChartPreset) => {
    if (preset === 'setup_only') {
      const s: ChartLayerSettings = {
        preset: 'setup_only',
        setupOnlyMode: true,
        showStructure: true,
        showFvg: true,
        fvgMaxCount: 1,
        fvgHideMitigated: true,
        fvgMaxDistanceAtr: 3,
        showLiquidity: true,
        showLiquidityBadges: true,
        liquidityIntactOnly: false,
        liquidityMaxCount: 1,
        showSessions: true,
        showTrade: true,
        showVolume: true,
      };
      setLayers(s);
      try { localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify(s)); } catch {}
    } else if (preset === 'focus') {
      const s: ChartLayerSettings = {
        preset: 'focus',
        setupOnlyMode: false,
        showStructure: true,
        showFvg: true,
        fvgMaxCount: 2,
        fvgHideMitigated: true,
        fvgMaxDistanceAtr: 2,
        showLiquidity: true,
        showLiquidityBadges: false,
        liquidityIntactOnly: true,
        liquidityMaxCount: 4,
        showSessions: false,
        showTrade: true,
        showVolume: false,
      };
      setLayers(s);
      try { localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify(s)); } catch {}
    } else if (preset === 'balanced') {
      const s: ChartLayerSettings = {
        preset: 'balanced',
        setupOnlyMode: false,
        showStructure: true,
        showFvg: true,
        fvgMaxCount: 3,
        fvgHideMitigated: true,
        fvgMaxDistanceAtr: 3,
        showLiquidity: true,
        showLiquidityBadges: true,
        liquidityIntactOnly: true,
        liquidityMaxCount: 6,
        showSessions: true,
        showTrade: true,
        showVolume: true,
      };
      setLayers(s);
      try { localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify(s)); } catch {}
    } else if (preset === 'pro') {
      const s: ChartLayerSettings = {
        preset: 'pro',
        setupOnlyMode: false,
        showStructure: true,
        showFvg: true,
        fvgMaxCount: 10,
        fvgHideMitigated: false,
        fvgMaxDistanceAtr: 10,
        showLiquidity: true,
        showLiquidityBadges: true,
        liquidityIntactOnly: false,
        liquidityMaxCount: 15,
        showSessions: true,
        showTrade: true,
        showVolume: true,
      };
      setLayers(s);
      try { localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify(s)); } catch {}
    }
  };

  const lastPrice = useMemo(() => {
    if (!candles || candles.length === 0) return undefined;
    return candles[candles.length - 1]!.close;
  }, [candles]);

  const effectiveFvgs = useMemo(() => {
    if (!layers.showFvg) return [];
    let list = fvgZones;

    if (layers.setupOnlyMode) {
      if (activeSetupFvgId) {
        const found = list.find((z) => z.id === activeSetupFvgId);
        if (found) return [found];
      }
      if (trade) {
        const match = list.find(
          (z) =>
            (trade.direction === 'long' ? z.direction === 'bullish' : z.direction === 'bearish') &&
            trade.entry >= z.low &&
            trade.entry <= z.high,
        );
        if (match) return [match];
      }
      const fresh = list.filter((z) => z.status === 'fresh' || z.status === 'partially_mitigated');
      return fresh.length > 0 ? [fresh[0]!] : [];
    }

    if (layers.fvgHideMitigated) {
      list = list.filter((z) => z.status === 'fresh' || (z.status === 'partially_mitigated' && z.mitigation < 0.60));
    }
    if (lastPrice !== undefined && candles.length >= 14 && layers.fvgMaxDistanceAtr < 999) {
      const atr = averageRange(candles, candles.length - 1, 14) ?? 1.5;
      list = list.filter((z) => {
        const dist = z.direction === 'bullish'
          ? (lastPrice > z.high ? lastPrice - z.high : (lastPrice < z.low ? z.low - lastPrice : 0))
          : (lastPrice < z.low ? z.low - lastPrice : (lastPrice > z.high ? lastPrice - z.high : 0));
        return (dist / (atr > 0 ? atr : 1)) <= layers.fvgMaxDistanceAtr;
      });
    }
    list = list.slice().sort((a, b) => b.createdTime - a.createdTime);
    if (layers.fvgMaxCount < 999) {
      list = list.slice(0, layers.fvgMaxCount);
    }
    return consolidateFvgZones(list);
  }, [fvgZones, layers.showFvg, layers.setupOnlyMode, activeSetupFvgId, trade, layers.fvgHideMitigated, layers.fvgMaxDistanceAtr, layers.fvgMaxCount, lastPrice, candles]);

  const effectiveLiquidity = useMemo(() => {
    if (!layers.showLiquidity) return [];
    let list = liquidity;

    if (layers.setupOnlyMode) {
      if (activeSetupLiquidityId) {
        const found = list.find((l) => l.id === activeSetupLiquidityId);
        if (found) return [found];
      }
      if (trade) {
        const nearSweep = list.find((l) => l.status === 'swept' && Math.abs(l.price - trade.stopLoss) < 15);
        if (nearSweep) return [nearSweep];
      }
      const swept = list.filter((l) => l.status === 'swept');
      return swept.length > 0 ? [swept[0]!] : [];
    }

    if (layers.liquidityIntactOnly) {
      list = list.filter((l) => l.status === 'intact');
    }
    if (lastPrice !== undefined) {
      list = filterCleanLevels(list, lastPrice, layers.liquidityMaxCount);
    }
    return list;
  }, [liquidity, layers.showLiquidity, layers.setupOnlyMode, activeSetupLiquidityId, trade, layers.liquidityIntactOnly, layers.liquidityMaxCount, lastPrice]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsControlsOpen(false);
      }
    };
    if (isControlsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isControlsOpen]);

  const toggleFullscreen = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    if (!document.fullscreenElement) {
      if (wrapper.requestFullscreen) {
        void wrapper.requestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // ---------------------------------------------------------------- create
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e13' },
        textColor: '#8695ad',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(38,48,63,0.45)' },
        horzLines: { color: 'rgba(38,48,63,0.45)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#5a6a86', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#26303f' },
        horzLine: { color: '#5a6a86', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#26303f' },
      },
      rightPriceScale: { borderColor: '#1b2230', scaleMargins: { top: 0.08, bottom: showVolume ? 0.24 : 0.08 } },
      timeScale: {
        borderColor: '#1b2230',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      handleScroll: true,
      handleScale: true,
      // Times are converted into the trader's zone rather than shown in UTC.
      localization: {
        timeFormatter: (time: Time) => {
          const date = new Date((time as number) * 1000);
          const hrs = String(date.getUTCHours()).padStart(2, '0');
          const mins = String(date.getUTCMinutes()).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = months[date.getUTCMonth()];
          return `${day} ${month} ${hrs}:${mins}`;
        },
      },
      autoSize: true,
      height: typeof height === 'number' ? height : undefined,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: pricePrecision, minMove: 1 / 10 ** pricePrecision },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    if (showVolume) {
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        color: '#26303f',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = volumeSeries;
    }

    const handleClick = chart.subscribeClick((param) => {
      if (!onPriceClick || !param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price !== null) onPriceClick(Number(price), Number(param.time));
    });

    const redraw = () => {
      requestAnimationFrame(() => drawOverlayRef.current());
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    const observer = new ResizeObserver(redraw);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      void handleClick;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [timezone, pricePrecision, showVolume, height]);
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    series.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          value: candle.volume ?? 0,
          color: candle.close >= candle.open ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)',
        })),
      );
    }

    const timer = setTimeout(() => {
      requestAnimationFrame(() => drawOverlayRef.current());
    }, 50);
    return () => clearTimeout(timer);
  }, [candles]);

  // --------------------------------------------------------------- markers
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    series.setMarkers(
      [...markers]
        .sort((a, b) => a.time - b.time)
        .map((marker) => ({
          time: marker.time as UTCTimestamp,
          position: marker.position,
          color: marker.color,
          shape: marker.shape,
          text: marker.text,
        })),
    );
  }, [markers]);

  // --------------------------------- price lines: liquidity and trade levels
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    const seenKeys = new Set<string>();
    for (const level of effectiveLiquidity) {
      const swept = level.status !== 'intact';
      const key = `${level.price.toFixed(2)}:${level.type}:${level.status}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      priceLinesRef.current.push(
        series.createPriceLine({
          price: level.price,
          color: swept ? '#2a3447' : level.side === 'buy-side' ? '#ef4444' : '#22c55e',
          lineWidth: 1,
          lineStyle: swept ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        }),
      );
    }

    if (trade) {
      const levels: [number | null | undefined, string, string][] = [
        [trade.entry, 'ENTRY', '#a78bfa'],
        [trade.stopLoss, 'SL', '#ef4444'],
        [trade.takeProfit1, 'TP1', '#22c55e'],
        [trade.takeProfit2, 'TP2', '#22c55e'],
        [trade.takeProfit3, 'TP3', '#22c55e'],
      ];
      for (const [price, title, color] of levels) {
        if (price == null || !Number.isFinite(price)) continue;
        priceLinesRef.current.push(
          series.createPriceLine({
            price,
            color,
            lineWidth: title === 'ENTRY' ? 2 : 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title,
          }),
        );
      }
    }

    drawOverlayRef.current();
  }, [effectiveLiquidity, trade]);

  // ----------------------------- overlay: FVG zones, sessions, R:R shading
  useEffect(() => {
    const draw = () => {
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const canvas = overlayRef.current;
      const container = containerRef.current;
      if (!chart || !series || !canvas || !container) return;

      const width = container.clientWidth;
      const canvasHeight = container.clientHeight;
      const ratio = window.devicePixelRatio || 1;

      if (canvas.width !== width * ratio || canvas.height !== canvasHeight * ratio) {
        canvas.width = width * ratio;
        canvas.height = canvasHeight * ratio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${canvasHeight}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, canvasHeight);

      const timeScale = chart.timeScale();
      const toX = (time: number): number | null => {
        const coordinate = timeScale.timeToCoordinate(time as UTCTimestamp);
        if (coordinate !== null) return Number(coordinate);
        if (candles.length > 0) {
          // Binary search O(log N) for nearest candle timestamp fallback
          let low = 0;
          let high = candles.length - 1;
          while (low <= high) {
            const mid = (low + high) >> 1;
            if (candles[mid]!.time === time) {
              low = mid;
              break;
            }
            if (candles[mid]!.time < time) low = mid + 1;
            else high = mid - 1;
          }
          const idx = Math.min(Math.max(0, low), candles.length - 1);
          const coord = timeScale.timeToCoordinate(candles[idx]!.time as UTCTimestamp);
          if (coord !== null) return Number(coord);
        }
        return null;
      };
      const toY = (price: number): number | null => {
        const coordinate = series.priceToCoordinate(price);
        return coordinate === null ? null : Number(coordinate);
      };

      const toYBounds = (high: number, low: number): { top: number; bottom: number } | null => {
        const topCoord = series.priceToCoordinate(high);
        const bottomCoord = series.priceToCoordinate(low);

        if (topCoord === null && bottomCoord === null) return null;
        const top = topCoord === null ? -100 : Number(topCoord);
        const bottom = bottomCoord === null ? canvasHeight + 100 : Number(bottomCoord);

        return { top, bottom };
      };

      // Session range boxes: bounding box spanning [start, end] and [sessionHigh, sessionLow]
      if (layers.showSessions) {
        // Filter for enabled, primary sessions to prevent overlapping duplicate boxes
        const validSessions = sessions.filter((s) => s.definition.enabled !== false && s.definition.kind !== 'overlap');

        for (const occurrence of validSessions) {
          const left = toX(occurrence.start);
          const right = toX(occurrence.end);
          if (left === null && right === null) continue;
          const x1 = Math.max(0, left ?? 0);
          const x2 = Math.min(width, right ?? width);
          if (x2 <= x1 + 10) continue;

          // Find session candles to calculate actual session high and low
          const sessionCandles = candles.filter(
            (c) => c.time >= occurrence.start && c.time <= occurrence.end,
          );
          if (sessionCandles.length === 0) continue;

          const sessionHigh = Math.max(...sessionCandles.map((c) => c.high));
          const sessionLow = Math.min(...sessionCandles.map((c) => c.low));

          const topCoord = toY(sessionHigh);
          const bottomCoord = toY(sessionLow);
          if (topCoord === null || bottomCoord === null) continue;

          const boxY = Math.min(topCoord, bottomCoord);
          const boxH = Math.max(16, Math.abs(bottomCoord - topCoord));
          const boxW = x2 - x1;

          const color = occurrence.definition.color || '#3b82f6';
          const sessionName = occurrence.definition.name;

          // 1. Draw soft tinted background fill
          ctx.fillStyle = `${color}12`;
          ctx.fillRect(x1, boxY, boxW, boxH);

          // 2. Draw clean dotted/dashed bounding box outline
          ctx.strokeStyle = `${color}bb`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(x1, boxY, boxW, boxH);
          ctx.setLineDash([]);

          // 3. Draw sleek dark badge for session name inside top-left
          if (boxW > 45) {
            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace';
            const labelText = `${sessionName.toUpperCase()} · H: ${sessionHigh.toFixed(2)} / L: ${sessionLow.toFixed(2)}`;
            const badgeW = Math.min(boxW - 8, ctx.measureText(labelText).width + 12);

            ctx.fillStyle = 'rgba(11, 14, 19, 0.85)';
            ctx.fillRect(x1 + 4, boxY + 4, badgeW, 16);

            ctx.strokeStyle = `${color}55`;
            ctx.strokeRect(x1 + 4, boxY + 4, badgeW, 16);

            ctx.fillStyle = color;
            ctx.fillRect(x1 + 4, boxY + 4, 3, 16);

            ctx.fillStyle = '#f8fafc';
            ctx.fillText(badgeW >= 140 ? labelText : sessionName.toUpperCase(), x1 + 10, boxY + 16);
          }
        }
      }

      // FVG zones: precision LuxAlgo/TradingView bounded boxes from formation to mitigation
      for (const zone of effectiveFvgs) {
        const bounds = toYBounds(zone.high, zone.low);
        if (!bounds) continue;
        const { top, bottom } = bounds;

        const formationTime = zone.sourceCandleTimes ? zone.sourceCandleTimes[0] : zone.createdTime;
        const startX = toX(formationTime);
        const dead = zone.status === 'fully_mitigated' || zone.status === 'invalidated';

        let x = startX === null ? 0 : Math.max(0, startX);
        let endX = width;

        if (zone.firstTouchTime) {
          const touchX = toX(zone.firstTouchTime);
          if (touchX !== null) {
            endX = Math.max(x + 12, touchX);
          }
        }

        const zoneWidth = Math.max(12, endX - x);
        if (zoneWidth <= 0 || x >= width) continue;

        const boxY = Math.min(top, bottom);
        const boxHeight = Math.max(6, Math.abs(bottom - top));

        const bullish = zone.direction === 'bullish';
        const baseColor = bullish ? '34, 197, 94' : '239, 68, 68';
        const fillAlpha = dead ? 0.08 : zone.status === 'partially_mitigated' ? 0.14 : 0.20;
        const borderAlpha = dead ? 0.35 : 0.70;

        // 1. Draw soft tinted rectangular box fill
        ctx.fillStyle = `rgba(${baseColor}, ${fillAlpha})`;
        ctx.fillRect(x, boxY, zoneWidth, boxHeight);

        // 2. Draw clean dotted 1px border outline
        ctx.strokeStyle = `rgba(${baseColor}, ${borderAlpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, boxY, zoneWidth, boxHeight);
        ctx.setLineDash([]);

        // 3. Draw clean, subtle "FVG" text centered in the box
        if (zoneWidth > 24 && boxHeight >= 6) {
          const labelText = 'FVG';
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
          const textW = ctx.measureText(labelText).width;
          const textX = x + (zoneWidth / 2) - (textW / 2);
          const textY = boxY + (boxHeight / 2) + 3;

          ctx.fillStyle = `rgba(${baseColor}, ${dead ? 0.5 : 0.9})`;
          ctx.fillText(labelText, Math.max(x + 4, textX), textY);
        }
      }

      // Market Structure Breaks: LuxAlgo SMC horizontal break lines (BOS & CHoCH)
      if (layers.showStructure && structureEvents.length > 0) {
        const recent = structureEvents.slice(-12);
        for (const event of recent) {
          const y = toY(event.brokenLevel);
          if (y === null || y < -20 || y > canvasHeight + 20) continue;

          const startX = toX(event.brokenSwingTime);
          const endX = toX(event.time);
          if (startX === null && endX === null) continue;

          const x1 = Math.max(0, startX ?? 0);
          const x2 = Math.min(width, endX ?? width);
          if (x2 <= x1 + 6) continue;

          const isBull = event.direction === 'bullish';
          const color = isBull ? '#22c55e' : '#ef4444';
          const isBOS = event.kind === 'BOS';

          // 1. Draw horizontal break line spanning from broken swing to breakout candle
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash(isBOS ? [] : [4, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, y + 0.5);
          ctx.lineTo(x2, y + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);

          // 2. Draw subtle anchor dot at swing start
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x1, y + 0.5, 2, 0, Math.PI * 2);
          ctx.fill();

          // 3. Draw clean LuxAlgo-style label badge centered on the break line
          const label = event.kind;
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
          const textWidth = ctx.measureText(label).width;
          const textX = (x1 + x2) / 2 - textWidth / 2;
          const textY = isBull ? y - 4 : y + 11;

          ctx.fillStyle = 'rgba(11, 14, 19, 0.85)';
          ctx.fillRect(textX - 3, textY - 9, textWidth + 6, 12);
          ctx.strokeStyle = `${color}66`;
          ctx.lineWidth = 1;
          ctx.strokeRect(textX - 3, textY - 9, textWidth + 6, 12);

          ctx.fillStyle = color;
          ctx.fillText(label, textX, textY);
        }
      }

      // Risk/reward shading between entry and each side.
      if (layers.showTrade && trade) {
        const entryY = toY(trade.entry);
        const stopY = toY(trade.stopLoss);
        if (entryY !== null && stopY !== null) {
          ctx.fillStyle = 'rgba(239,68,68,0.10)';
          ctx.fillRect(0, Math.min(entryY, stopY), width, Math.abs(stopY - entryY));
        }
        const target = trade.takeProfit2 ?? trade.takeProfit1;
        const targetY = target != null ? toY(target) : null;
        if (entryY !== null && targetY !== null) {
          ctx.fillStyle = 'rgba(34,197,94,0.10)';
          ctx.fillRect(0, Math.min(entryY, targetY), width, Math.abs(targetY - entryY));
        }
      }

      // Render precision liquidity level lines & inline badges directly on canvas
      if (layers.showLiquidity) {
        const visibleLevels: { level: LiquidityLevel; rawY: number }[] = [];

        for (const level of effectiveLiquidity) {
          const y = toY(level.price);
          if (y === null || y < -20 || y > canvasHeight + 20) continue;
          visibleLevels.push({ level, rawY: Math.round(y) });
        }

        visibleLevels.sort((a, b) => a.rawY - b.rawY);

        const BADGE_H = 18;
        const badgePositions = visibleLevels.map((item) => item.rawY);

        for (let i = 1; i < badgePositions.length; i++) {
          if (badgePositions[i]! < badgePositions[i - 1]! + BADGE_H + 2) {
            badgePositions[i] = badgePositions[i - 1]! + BADGE_H + 2;
          }
        }

        for (let i = 0; i < visibleLevels.length; i++) {
          const { level, rawY } = visibleLevels[i]!;
          const targetY = badgePositions[i]!;
          const swept = level.status !== 'intact';
          const isBuy = level.side === 'buy-side';
          const color = swept ? '#64748b' : isBuy ? '#ef4444' : '#22c55e';
          const bgFill = swept ? 'rgba(30, 41, 59, 0.90)' : isBuy ? 'rgba(153, 27, 27, 0.90)' : 'rgba(20, 83, 45, 0.90)';
          const lineEndX = layers.showLiquidityBadges ? width - 155 : width;

          // 1. Draw horizontal level line across chart at 100% exact Y
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash(swept ? [2, 3] : [5, 4]);
          ctx.beginPath();
          ctx.moveTo(0, rawY + 0.5);
          ctx.lineTo(lineEndX, rawY + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);

          if (layers.showLiquidityBadges) {
            // 2. Connector line if badge displaced for stack collision
            if (Math.abs(targetY - rawY) > 2) {
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(width - 155, rawY + 0.5);
              ctx.lineTo(width - 148, targetY + 0.5);
              ctx.stroke();
            }

            // 3. Draw laser-aligned inline pill badge
            const badgeX = width - 148;
            const badgeY = targetY - 9;
            const badgeW = 140;
            const badgeH = 18;

            ctx.fillStyle = bgFill;
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

            ctx.fillStyle = color;
            ctx.fillRect(badgeX, badgeY, 3, badgeH);

            const displaySide = isBuy ? 'Buyside' : 'Sellside';
            const labelText = level.label ? `${level.label} ${level.price.toFixed(2)}` : `${displaySide} ${level.price.toFixed(2)}`;
            ctx.fillStyle = swept ? '#cbd5e1' : '#ffffff';
            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace';
            ctx.fillText(labelText.length > 22 ? labelText.slice(0, 22) : labelText, badgeX + 6, targetY + 3);
          }
        }
      }
    };

    drawOverlayRef.current = draw;
    draw();

    const timer = setTimeout(() => {
      requestAnimationFrame(() => draw());
    }, 50);
    return () => clearTimeout(timer);
  }, [effectiveFvgs, effectiveLiquidity, sessions, trade, candles, layers]);

  return (
    <div
      ref={wrapperRef}
      className={isFullscreen ? 'fixed inset-0 z-50 bg-[#0b0e13] p-2 flex flex-col h-screen w-screen' : 'relative w-full'}
      style={isFullscreen ? { height: '100vh', width: '100vw' } : { height }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 z-10" />

      {/* Top Right Interactive Chart Toolbar */}
      <div className="absolute top-2 right-14 z-20 flex items-center gap-1.5 font-mono text-2xs select-none">
        {/* Preset quick buttons */}
        <div className="hidden sm:flex items-center bg-zinc-900/90 border border-zinc-800 rounded p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => applyPreset('setup_only')}
            className={`px-2.5 py-0.5 rounded font-bold transition-all ${
              layers.preset === 'setup_only' || layers.setupOnlyMode
                ? 'bg-amber-500 text-zinc-950 shadow-sm'
                : 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-950/30'
            }`}
            title="Setup Only Mode: Strictly display only the active setup's FVG and swept level"
          >
            🎯 Setup Only
          </button>
          <button
            type="button"
            onClick={() => applyPreset('focus')}
            className={`px-2 py-0.5 rounded transition-colors ${
              layers.preset === 'focus' && !layers.setupOnlyMode
                ? 'bg-zinc-700 text-zinc-100 font-bold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Focus Mode: Only active trade & immediate levels, maximum chart clarity"
          >
            Clean
          </button>
          <button
            type="button"
            onClick={() => applyPreset('balanced')}
            className={`px-2 py-0.5 rounded transition-colors ${
              layers.preset === 'balanced' && !layers.setupOnlyMode
                ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Balanced Mode: Clean SMC analysis with top 3 fresh FVGs and intact liquidity"
          >
            ⚖️ Balanced
          </button>
          <button
            type="button"
            onClick={() => applyPreset('pro')}
            className={`px-2 py-0.5 rounded transition-colors ${
              layers.preset === 'pro' && !layers.setupOnlyMode
                ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Pro Mode: Display all historical zones, sessions & full liquidity map"
          >
            🔍 Pro Full
          </button>
        </div>

        {/* Master Control Panel Popover Button */}
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setIsControlsOpen((prev) => !prev)}
            className={`px-2.5 py-1 rounded border shadow flex items-center gap-1.5 transition-all ${
              isControlsOpen
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 ring-1 ring-amber-500/30'
                : 'bg-zinc-800/90 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Open Chart Layer Controls"
          >
            <span>⚙️ Layers</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-950/60 text-zinc-400 border border-zinc-800">
              FVG: {effectiveFvgs.length} · Liq: {effectiveLiquidity.length}
            </span>
          </button>

          {/* Floating Dropdown Modal */}
          {isControlsOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-zinc-950/95 backdrop-blur-md border border-zinc-700/80 shadow-2xl rounded-lg p-3.5 z-50 text-xs text-zinc-200 font-mono space-y-3.5 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-bold tracking-wider text-zinc-100 flex items-center gap-1.5">
                  <span>⚙️</span> CHART LAYER CONTROLS
                </span>
                <button
                  type="button"
                  onClick={() => setIsControlsOpen(false)}
                  className="text-zinc-500 hover:text-zinc-200 text-sm px-1"
                >
                  ✕
                </button>
              </div>

              {/* Setup Only Mode Banner */}
              <div className="bg-amber-950/40 border border-amber-500/40 p-2.5 rounded flex items-center justify-between">
                <div>
                  <div className="font-bold text-amber-300 flex items-center gap-1 text-2xs">
                    <span>🎯</span> ACTIVE SETUP ONLY
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    Isolate only the active setup's FVG & sweep level
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={layers.setupOnlyMode}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      applyPreset('setup_only');
                    } else {
                      updateLayers({ setupOnlyMode: false, preset: 'balanced' });
                    }
                  }}
                  className="accent-amber-500 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* FVG Settings */}
              <div className="space-y-2 bg-zinc-900/60 p-2.5 rounded border border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1">
                    <span>🟢</span> Fair Value Gaps (FVG)
                  </span>
                  <input
                    type="checkbox"
                    checked={layers.showFvg}
                    onChange={(e) => updateLayers({ showFvg: e.target.checked })}
                    className="accent-emerald-500 w-4 h-4 cursor-pointer"
                  />
                </div>

                {layers.showFvg && (
                  <div className="space-y-2 pt-1.5 text-2xs text-zinc-400">
                    <label className="flex items-center justify-between cursor-pointer hover:text-zinc-200">
                      <span>Hide Fully Mitigated Gaps</span>
                      <input
                        type="checkbox"
                        checked={layers.fvgHideMitigated}
                        onChange={(e) => updateLayers({ fvgHideMitigated: e.target.checked })}
                        className="accent-emerald-500 w-3.5 h-3.5 cursor-pointer"
                      />
                    </label>

                    <div className="flex items-center justify-between">
                      <span>Max Zones Shown:</span>
                      <div className="flex gap-1">
                        {[2, 3, 5, 999].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => updateLayers({ fvgMaxCount: count })}
                            className={`px-1.5 py-0.5 rounded border ${
                              layers.fvgMaxCount === count
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                            }`}
                          >
                            {count === 999 ? 'All' : count}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>Max Price Distance:</span>
                      <div className="flex gap-1">
                        {[2, 3, 5, 999].map((dist) => (
                          <button
                            key={dist}
                            type="button"
                            onClick={() => updateLayers({ fvgMaxDistanceAtr: dist })}
                            className={`px-1.5 py-0.5 rounded border ${
                              layers.fvgMaxDistanceAtr === dist
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                            }`}
                          >
                            {dist === 999 ? 'Any' : `${dist} ATR`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Liquidity Settings */}
              <div className="space-y-2 bg-zinc-900/60 p-2.5 rounded border border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-rose-400 flex items-center gap-1">
                    <span>🔴</span> Liquidity & Key Levels
                  </span>
                  <input
                    type="checkbox"
                    checked={layers.showLiquidity}
                    onChange={(e) => updateLayers({ showLiquidity: e.target.checked })}
                    className="accent-rose-500 w-4 h-4 cursor-pointer"
                  />
                </div>

                {layers.showLiquidity && (
                  <div className="space-y-2 pt-1.5 text-2xs text-zinc-400">
                    <label className="flex items-center justify-between cursor-pointer hover:text-zinc-200">
                      <span>Show Right Scale Badges</span>
                      <input
                        type="checkbox"
                        checked={layers.showLiquidityBadges}
                        onChange={(e) => updateLayers({ showLiquidityBadges: e.target.checked })}
                        className="accent-rose-500 w-3.5 h-3.5 cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer hover:text-zinc-200">
                      <span>Intact Levels Only (Hide Swept)</span>
                      <input
                        type="checkbox"
                        checked={layers.liquidityIntactOnly}
                        onChange={(e) => updateLayers({ liquidityIntactOnly: e.target.checked })}
                        className="accent-rose-500 w-3.5 h-3.5 cursor-pointer"
                      />
                    </label>

                    <div className="flex items-center justify-between">
                      <span>Max Levels Displayed:</span>
                      <div className="flex gap-1">
                        {[4, 6, 10, 20].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => updateLayers({ liquidityMaxCount: count })}
                            className={`px-1.5 py-0.5 rounded border ${
                              layers.liquidityMaxCount === count
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                            }`}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sessions & Other Overlays */}
              <div className="space-y-2 bg-zinc-900/60 p-2.5 rounded border border-zinc-800/80">
                <span className="font-semibold text-sky-400 flex items-center gap-1">
                  <span>🌐</span> Timing & Trade Layers
                </span>

                <div className="space-y-1.5 pt-1 text-2xs text-zinc-400">
                  <label className="flex items-center justify-between cursor-pointer hover:text-zinc-200">
                    <span>Session Background Boxes</span>
                    <input
                      type="checkbox"
                      checked={layers.showSessions}
                      onChange={(e) => updateLayers({ showSessions: e.target.checked })}
                      className="accent-sky-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer hover:text-zinc-200">
                    <span>Trade Entry / SL / TP Overlay</span>
                    <input
                      type="checkbox"
                      checked={layers.showTrade}
                      onChange={(e) => updateLayers({ showTrade: e.target.checked })}
                      className="accent-sky-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen Button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="px-2 py-1 rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 shadow transition-colors"
          title="Toggle Fullscreen Mode"
        >
          {isFullscreen ? '❌ Exit' : '⤢ Fullscreen'}
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-1 right-2 text-2xs text-ink-600 z-10 font-mono">
        {timeframe} · {timezone}
      </div>
    </div>
  );
}
