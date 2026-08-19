'use client';

import { useEffect, useRef } from 'react';
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
import type { Candle, FvgZone, LiquidityLevel, SessionOccurrence, Timeframe } from '@xau/core';

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
  trade?: TradeOverlay | null;
  showVolume?: boolean;
  height?: number;
  /** Called with the price the user clicked, for placing levels from the chart. */
  onPriceClick?: (price: number, time: number) => void;
}

const UP = '#22c55e';
const DOWN = '#ef4444';

export function TradingChart({
  candles,
  timeframe,
  timezone,
  pricePrecision = 2,
  fvgZones = [],
  liquidity = [],
  sessions = [],
  markers = [],
  trade = null,
  showVolume = true,
  height = 480,
  onPriceClick,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const drawOverlayRef = useRef<() => void>(() => {});

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
        timeFormatter: (time: Time) =>
          new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date((time as number) * 1000)),
      },
      autoSize: true,
      height,
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

    const redraw = () => drawOverlayRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const observer = new ResizeObserver(redraw);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      void handleClick;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // The chart instance is created once; data flows through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, pricePrecision, showVolume, height]);

  // ------------------------------------------------------------------ data
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

    drawOverlayRef.current();
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

    for (const level of liquidity) {
      // A swept level stays on the chart, dimmed and dashed: it is history
      // that still matters, not something to delete.
      const swept = level.status !== 'intact';
      priceLinesRef.current.push(
        series.createPriceLine({
          price: level.price,
          color: swept ? '#36435a' : level.side === 'buy-side' ? '#ef4444' : '#22c55e',
          lineWidth: 1,
          lineStyle: swept ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.type}${swept ? ` (${level.status})` : ''}`,
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
  }, [liquidity, trade]);

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

      canvas.width = width * ratio;
      canvas.height = canvasHeight * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${canvasHeight}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, canvasHeight);

      const timeScale = chart.timeScale();
      const toX = (time: number): number | null => {
        const coordinate = timeScale.timeToCoordinate(time as UTCTimestamp);
        return coordinate === null ? null : Number(coordinate);
      };
      const toY = (price: number): number | null => {
        const coordinate = series.priceToCoordinate(price);
        return coordinate === null ? null : Number(coordinate);
      };

      // Session bands, drawn behind everything else.
      for (const occurrence of sessions) {
        const left = toX(occurrence.start);
        const right = toX(occurrence.end);
        if (left === null && right === null) continue;
        const x1 = Math.max(0, left ?? 0);
        const x2 = Math.min(width, right ?? width);
        if (x2 <= x1) continue;

        ctx.fillStyle = `${occurrence.definition.color}12`;
        ctx.fillRect(x1, 0, x2 - x1, canvasHeight);
        ctx.strokeStyle = `${occurrence.definition.color}44`;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, canvasHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        if (x2 - x1 > 60) {
          ctx.fillStyle = `${occurrence.definition.color}cc`;
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(occurrence.definition.name.toUpperCase(), x1 + 4, 12);
        }
      }

      // FVG zones. Live zones are solid-ish; dead zones are faded and hatched,
      // so a violated gap can never be mistaken for a tradeable location.
      for (const zone of fvgZones) {
        const top = toY(zone.high);
        const bottom = toY(zone.low);
        const start = toX(zone.createdTime);
        if (top === null || bottom === null) continue;

        const x = start === null ? 0 : Math.max(0, start);
        const zoneWidth = width - x;
        if (zoneWidth <= 0) continue;

        const dead = zone.status === 'fully_mitigated' || zone.status === 'invalidated';
        const bullish = zone.direction === 'bullish';
        const base = bullish ? '34,197,94' : '239,68,68';
        const alpha = dead ? 0.05 : zone.status === 'partially_mitigated' ? 0.1 : 0.16;

        ctx.fillStyle = `rgba(${base},${alpha})`;
        ctx.fillRect(x, Math.min(top, bottom), zoneWidth, Math.abs(bottom - top));

        ctx.strokeStyle = `rgba(${base},${dead ? 0.2 : 0.5})`;
        ctx.setLineDash(dead ? [2, 4] : []);
        ctx.strokeRect(x, Math.min(top, bottom), zoneWidth, Math.abs(bottom - top));
        ctx.setLineDash([]);

        if (Math.abs(bottom - top) > 12 && zoneWidth > 90) {
          ctx.fillStyle = `rgba(${base},${dead ? 0.4 : 0.9})`;
          ctx.font = '9px ui-monospace, monospace';
          const label = dead
            ? `${zone.timeframe} FVG · ${zone.status.replace('_', ' ')}`
            : `${zone.timeframe} FVG · ${zone.status === 'fresh' ? 'fresh' : `${Math.round(zone.mitigation * 100)}% mitigated`}`;
          ctx.fillText(label, x + 4, Math.min(top, bottom) + 11);
        }
      }

      // Risk/reward shading between entry and each side.
      if (trade) {
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
    };

    drawOverlayRef.current = draw;
    draw();
  }, [fvgZones, sessions, trade, candles]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute bottom-1 right-2 text-2xs text-ink-600">
        {timeframe} · {timezone}
      </div>
    </div>
  );
}
