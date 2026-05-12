import { Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useMemo, useRef, useEffect, useState } from 'react';

const createCustomYAxisLabel = (labelText: string, color: string) => {
  return (props: any) => {
    const { viewBox } = props;
    if (!viewBox) return null;
    const { x, y, height } = viewBox;
    const labelX = x - 22;
    return (
      <g>
        <text
          x={labelX}
          y={y + height / 2}
          fill={color}
          fontSize="12px"
          fontWeight="600"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(-90, ${labelX}, ${y + height / 2})`}
        >
          {labelText}
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
  theme?: "default" | "ansys";
  options?: {
    showMean?: boolean;
    showCI?: boolean;
    showMarkers?: boolean;
    gridMode?: "none" | "x" | "both";
    plotStyle?: "line" | "both";
    xAxisLabel?: string;
    yAxisLabel?: string;
    meanLabel?: string;
    ciLabel?: string;
  };
};

export default function UQChart({
  data,
  title,
  yLabel,
  color,
  ciFillColor,
  isDashed = false,
  theme = "default",
  options,
}: UQChartProps) {
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

  const showMean = options?.showMean ?? true;
  const showCI = (options?.plotStyle ?? "both") === "both" && (options?.showCI ?? true);
  const showMarkers = options?.showMarkers ?? true;
  const gridMode = options?.gridMode ?? "both";
  const xAxisLabel = options?.xAxisLabel ?? "Angle of Attack (AOA)";
  const yAxisLabel = options?.yAxisLabel ?? yLabel;
  const meanLabel = options?.meanLabel ?? "Mean";
  const ciLabel = options?.ciLabel ?? "95% CI";
  const isAnsys = theme === "ansys";
  const axisTextColor = isAnsys ? "#1f2937" : "rgba(255, 255, 255, 0.98)";
  const gridStroke = isAnsys ? "rgba(126, 138, 156, 0.55)" : "rgba(160, 175, 200, 0.9)";
  const tooltipStyle = isAnsys
    ? {
        backgroundColor: "#f4f5f7",
        border: "1px solid #aab2bf",
        borderRadius: "4px",
        color: "#111827",
        fontSize: "12px",
        boxShadow: "0 6px 14px rgba(15, 23, 42, 0.18)",
      }
    : {
        backgroundColor: "#1e1e1e",
        border: "1px solid #2d2d2d",
        borderRadius: "8px",
        color: "#fafafa",
        fontSize: "12px",
      };

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

  const chartBodyRef = useRef<HTMLDivElement>(null);
  const CustomLabel = createCustomYAxisLabel(yAxisLabel, axisTextColor);

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
    <div className={`uq-chart-container ${isAnsys ? "uq-chart-container--ansys" : ""}`}>
      <div className="chart-title">{title}</div>
      {dataStats && null}
      <div className="chart-body" ref={chartBodyRef}>
        {chartBodySize.width > 0 && chartBodySize.height > 0 && (
          <ComposedChart
            width={Math.floor(chartBodySize.width)}
            height={Math.floor(chartBodySize.height)}
            data={chartData}
            margin={isAnsys ? { top: 20, right: 24, left: 54, bottom: 48 } : { top: 24, right: 16, left: 48, bottom: 42 }}
            style={{ background: 'transparent' }}
          >
            <CartesianGrid
              strokeDasharray={isAnsys ? "1 0" : "2 3"}
              stroke={gridStroke}
              vertical={gridMode === "both"}
              horizontal={gridMode === "both" || gridMode === "x"}
            />
            <XAxis
              dataKey="AOA"
              domain={xDomain}
              stroke={axisTextColor}
              tick={{ fill: axisTextColor, fontSize: 12, fontWeight: '600' }}
              label={{ value: xAxisLabel, position: 'bottom', offset: 8, fill: axisTextColor, style: { fontSize: 12, fontWeight: '600' } }}
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
              stroke={axisTextColor}
              tick={{ fill: axisTextColor, fontSize: 12, fontWeight: '600' }}
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
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    color: isAnsys ? '#111827' : '#ffffff',
                    fontSize: 12,
                    fontWeight: '600',
                    flexWrap: 'wrap',
                  }}
                >
                  {showMean && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 20, height: 2, backgroundColor: color, borderStyle: isDashed ? 'dashed' : 'solid', borderWidth: 2, borderColor: color }} />
                      <span>{meanLabel}</span>
                    </div>
                  )}
                  {showCI && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 20, height: 14, backgroundColor: ciFillColor, borderRadius: 2, border: isAnsys ? '1px solid rgba(31, 41, 55, 0.18)' : undefined }} />
                      <span>{ciLabel}</span>
                    </div>
                  )}
                </div>
              )}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: isAnsys ? '#111827' : '#fafafa', fontSize: '12px', fontWeight: 600 }}
            />
            {showCI && (
              <>
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
                  fillOpacity={isAnsys ? 0.55 : 1}
                  isAnimationActive={false}
                  legendType="none"
                />
              </>
            )}
            {showMean && (
              <Line
                type="monotone"
                dataKey="Mean"
                stroke={color}
                strokeWidth={isAnsys ? 2.1 : 2.5}
                strokeDasharray={isDashed ? "5 5" : "0"}
                dot={showMarkers ? { fill: color, r: isAnsys ? 3 : 4, strokeWidth: 2, stroke: isAnsys ? '#f8fafc' : '#ffffff' } : false}
                activeDot={showMarkers ? { r: isAnsys ? 4 : 5, strokeWidth: 2, stroke: isAnsys ? '#f8fafc' : '#ffffff' } : false}
                name={meanLabel}
                isAnimationActive={false}
                legendType="line"
              />
            )}
          </ComposedChart>
        )}
      </div>
    </div>
  );
}
