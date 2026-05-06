import { Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMemo, useRef, useEffect, useState } from 'react';

// Custom YAxis label - compact for small square charts
const createCustomYAxisLabel = (baseLabel: string, subscript: string) => {
  return (props: any) => {
    const { viewBox } = props;
    if (!viewBox) return null;
    const { x, y, height } = viewBox;
    const labelX = x - 20;
    return (
      <g>
        <text
          x={labelX}
          y={y + height / 2}
          fill="rgba(255, 255, 255, 0.98)"
          fontSize="12px"
          fontWeight="600"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(-90, ${labelX}, ${y + height / 2})`}
        >
          <tspan>{baseLabel} (C</tspan>
          <tspan dy="3" fontSize="9px">{subscript}</tspan>
          <tspan dy="-2">)</tspan>
        </text>
      </g>
    );
  };
};

type DataPoint = {
  AOA: number;
  Mean: number;
  UQ: number;
};

type UQChartProps = {
  data: DataPoint[];
  title: string;
  yLabel: string;
  color: string;
  ciFillColor: string;
  isDashed?: boolean;
};

export default function UQChart({ data, title, yLabel, color, ciFillColor, isDashed = false }: UQChartProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [chartBodySize, setChartBodySize] = useState({ width: 0, height: 0 });
  const chartData = useMemo(() => {
    return data.map(point => ({
      AOA: point.AOA,
      Mean: point.Mean,
      UQ: point.UQ,
      LowerBound: point.Mean - point.UQ,
      UpperBound: point.Mean + point.UQ,
      UpperDelta: point.UQ * 2,
    }));
  }, [data]);

  const dataStats = useMemo(() => {
    if (!chartData.length) return null;
    const aoaValues = chartData.map((point) => point.AOA).filter((value) => Number.isFinite(value));
    const meanValues = chartData.map((point) => point.Mean).filter((value) => Number.isFinite(value));
    if (!aoaValues.length || !meanValues.length) return null;
    return {
      rows: chartData.length,
      aoaMin: Math.min(...aoaValues),
      aoaMax: Math.max(...aoaValues),
      meanMin: Math.min(...meanValues),
      meanMax: Math.max(...meanValues),
    };
  }, [chartData]);

  // Axis domains and ticks based on CSV data
  const isDrag = yLabel.includes('Drag');
  const xValues = useMemo(
    () => data.map((point) => point.AOA).filter((value) => Number.isFinite(value)),
    [data]
  );
  const xTicks = useMemo(() => {
    if (!xValues.length) return [] as number[];
    return Array.from(new Set(xValues)).sort((a, b) => a - b);
  }, [xValues]);
  const xDomain: [number, number] = xTicks.length
    ? [xTicks[0], xTicks[xTicks.length - 1]]
    : [0, 1];

  const yValues = useMemo(() => {
    return data
      .flatMap((point) => [point.Mean - point.UQ, point.Mean + point.UQ])
      .filter((value) => Number.isFinite(value));
  }, [data]);
  const yMin = yValues.length ? Math.min(...yValues) : (isDrag ? 0 : 0.25);
  const yMax = yValues.length ? Math.max(...yValues) : (isDrag ? 0.04 : 1.75);
  const yPadding = Math.max((yMax - yMin) * 0.1, isDrag ? 0.002 : 0.05);
  const yDomain: [number, number] = [yMin - yPadding, yMax + yPadding];
  const yTicks = useMemo(() => {
    if (!yValues.length) return [] as number[];
    const steps = 5;
    const step = (yDomain[1] - yDomain[0]) / (steps - 1 || 1);
    return Array.from({ length: steps }, (_, idx) => {
      const value = yDomain[0] + step * idx;
      const precision = isDrag ? 3 : 2;
      return Number(value.toFixed(precision));
    });
  }, [yDomain, yValues.length, isDrag]);

  // Extract base label and determine subscript
  const baseLabel = yLabel
    .replace(/ \(C[LD](?:\u2097|\u1D48)?\)/, '')
    .replace(/ \(C<sub>[LD]<\/sub>\)/, '')
    .replace(/ \(C[LD]\)/, '');
  const subscript = yLabel.includes('Lift') ? 'L' : 'D';
  const CustomLabel = createCustomYAxisLabel(baseLabel, subscript);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const target = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!chartBodyRef.current || typeof ResizeObserver === 'undefined') return;
    const target = chartBodyRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setChartBodySize({ width, height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);


  return (
    <div className="uq-chart-container" ref={containerRef}>
      <div className="chart-title">{title}</div>
      {dataStats && null}
      <div className="chart-body" ref={chartBodyRef}>
        {chartBodySize.width > 0 && chartBodySize.height > 0 && (
          <ComposedChart
            width={Math.floor(chartBodySize.width)}
            height={Math.floor(chartBodySize.height)}
            data={chartData}
            margin={{ top: 24, right: 16, left: 48, bottom: 42 }}
            style={{ background: 'transparent' }}
          >
            <CartesianGrid
              strokeDasharray="2 3"
              stroke="rgba(160, 175, 200, 0.9)"
              verticalValues={xTicks}
              horizontalValues={yTicks}
              syncWithTicks={true}
            />
            <XAxis
              dataKey="AOA"
              domain={xDomain}
              stroke="#ffffff"
              tick={{ fill: 'rgba(255, 255, 255, 0.98)', fontSize: 12, fontWeight: '600' }}
              label={{ value: 'Angle of Attack (AOA)', position: 'bottom', offset: 8, fill: 'rgba(255, 255, 255, 0.98)', style: { fontSize: 12, fontWeight: '600' } }}
              ticks={xTicks.length ? xTicks : undefined}
              tickFormatter={(value: number) => value.toString()}
              allowDataOverflow={false}
              tickMargin={4}
              padding={{ left: 0, right: 0 }}
              interval={0}
              allowDecimals={false}
            />
            <YAxis
              domain={yDomain}
              stroke="#ffffff"
              tick={{ fill: 'rgba(255, 255, 255, 0.98)', fontSize: 12, fontWeight: '600' }}
              label={CustomLabel}
              ticks={yTicks.length ? yTicks : undefined}
              tickFormatter={(value: number) => {
                if (isNaN(value) || !isFinite(value)) return '';
                return value.toFixed(isDrag ? 3 : 2);
              }}
              allowDataOverflow={false}
              tickMargin={4}
              width={50}
              padding={{ top: 0, bottom: 0 }}
              interval={0}
              allowDecimals={true}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8, paddingLeft: 6 }}
              iconType="line"
              formatter={(value) => value}
              content={() => (
                <div style={{ display: 'flex', gap: 12, color: '#ffffff', fontSize: 12, fontWeight: '600' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, backgroundColor: color, borderStyle: isDashed ? 'dashed' : 'solid', borderWidth: 2, borderColor: color }} />
                    <span>Mean</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 14, backgroundColor: ciFillColor, borderRadius: 2 }} />
                    <span>95% CI</span>
                  </div>
                </div>
              )}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e1e1e',
                border: '1px solid #2d2d2d',
                borderRadius: '8px',
                color: '#fafafa',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#fafafa', fontSize: '12px' }}
            />
            <Area
              type="monotone"
              dataKey="LowerBound"
              stackId="ci"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="UpperDelta"
              stackId="ci"
              stroke="none"
              fill={ciFillColor}
              fillOpacity={1}
              isAnimationActive={false}
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="Mean"
              stroke={color}
              strokeWidth={2.5}
              strokeDasharray={isDashed ? "5 5" : "0"}
              dot={{ fill: color, r: 4, strokeWidth: 2, stroke: '#ffffff' }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
              name="Mean"
              isAnimationActive={false}
              legendType="line"
            />
          </ComposedChart>
        )}
      </div>
    </div>
  );
}
