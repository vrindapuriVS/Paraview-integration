import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import UQChart from "./UQChart";
import { useAppLayout } from "../context/AppLayoutContext";

type ChartRow = { AOA: number; Mean: number; UQ: number };
type StepKey = "cl" | "cd" | "residuals";
type GridMode = "None" | "X Axis" | "Both";
type PlotStyle = "Line" | "Both";

type ResidualData = {
  xLabel: string;
  yLabel: string;
  source?: string;
  series: Array<{
    key: string;
    label: string;
    values: number[];
  }>;
};

type ResidualChartRow = {
  iteration: number;
  [seriesKey: string]: number | null;
};

type AnalysisResultsWizardProps = {
  step: StepKey;
  clData: ChartRow[];
  cdData: ChartRow[];
  residualData: ResidualData | null;
  onStepChange: (step: StepKey) => void;
  onBackToGeometry: () => void;
  onExit: () => void;
};

const STEPS: { key: StepKey; label: string }[] = [
  { key: "cl", label: "CL (lift)" },
  { key: "cd", label: "CD (drag)" },
  { key: "residuals", label: "Residuals" },
];

const FALLBACK_RESIDUAL_COLORS = [
  "#d92525",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#f59e0b",
  "#0891b2",
  "#db2777",
  "#475569",
];

const residualColorFor = (key: string, index: number) => {
  const lowered = key.toLowerCase();
  if (lowered === "p" || lowered === "p_rgh") return "#d92525";
  if (lowered === "ux") return "#2563eb";
  if (lowered === "uy") return "#16a34a";
  if (lowered === "uz") return "#9333ea";
  if (lowered === "k") return "#f59e0b";
  if (lowered === "omega") return "#0891b2";
  if (lowered === "epsilon") return "#db2777";
  return FALLBACK_RESIDUAL_COLORS[index % FALLBACK_RESIDUAL_COLORS.length]!;
};

const buildResidualRows = (residualData: ResidualData | null): ResidualChartRow[] => {
  if (!residualData?.series?.length) return [];
  const maxLen = residualData.series.reduce((best, series) => Math.max(best, series.values.length), 0);
  return Array.from({ length: maxLen }, (_, iteration) => {
    const row: ResidualChartRow = { iteration };
    for (const series of residualData.series) {
      const value = series.values[iteration];
      row[series.key] = Number.isFinite(value) ? value : null;
    }
    return row;
  });
};

function ResidualChart({
  data,
  series,
  gridMode,
  visibleSeries,
  xAxisLabel,
  yAxisLabel,
}: {
  data: ResidualChartRow[];
  series: Array<{ key: string; label: string; color: string }>;
  gridMode: GridMode;
  visibleSeries: Record<string, boolean>;
  xAxisLabel: string;
  yAxisLabel: string;
}) {
  const yValues = data.flatMap((row) =>
    series
      .filter((entry) => visibleSeries[entry.key])
      .map((entry) => row[entry.key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  );
  const yMin = yValues.length ? Math.min(...yValues) : 0;
  const yMax = yValues.length ? Math.max(...yValues) : 1;
  const yPadding = Math.max((yMax - yMin) * 0.08, 0.0001);

  return (
    <div className="analysis-results-wizard__ansys-chart analysis-results-wizard__ansys-chart--residuals">
      <div className="analysis-results-wizard__ansys-graph-title">Graph</div>
      <div className="analysis-results-wizard__ansys-graph-inner">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 24, left: 56, bottom: 46 }}>
            <CartesianGrid
              stroke="rgba(126, 138, 156, 0.55)"
              strokeDasharray="1 0"
              vertical={gridMode === "Both"}
              horizontal={gridMode === "Both" || gridMode === "X Axis"}
            />
            <XAxis
              dataKey="iteration"
              stroke="#1f2937"
              tick={{ fill: "#1f2937", fontSize: 12, fontWeight: 600 }}
              label={{
                value: xAxisLabel,
                position: "bottom",
                offset: 8,
                fill: "#1f2937",
                style: { fontSize: 12, fontWeight: 600 },
              }}
            />
            <YAxis
              domain={[Math.max(0, yMin - yPadding), yMax + yPadding]}
              stroke="#1f2937"
              tick={{ fill: "#1f2937", fontSize: 12, fontWeight: 600 }}
              label={{
                value: yAxisLabel,
                angle: -90,
                position: "insideLeft",
                fill: "#1f2937",
                style: { fontSize: 12, fontWeight: 600 },
              }}
              tickFormatter={(value: number) => value.toExponential(1)}
            />
            <Legend
              verticalAlign="top"
              align="center"
              wrapperStyle={{ paddingTop: 8, color: "#111827", fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#f4f5f7",
                border: "1px solid #aab2bf",
                borderRadius: "4px",
                color: "#111827",
                fontSize: "12px",
                boxShadow: "0 6px 14px rgba(15, 23, 42, 0.18)",
              }}
              labelStyle={{ color: "#111827", fontSize: "12px", fontWeight: 600 }}
            />
            {series.map((entry) =>
              visibleSeries[entry.key] ? (
                <Line
                  key={entry.key}
                  type="monotone"
                  dataKey={entry.key}
                  name={entry.label}
                  stroke={entry.color}
                  strokeWidth={2}
                  dot={{ fill: entry.color, r: 3, strokeWidth: 1.5, stroke: "#f8fafc" }}
                  activeDot={{ r: 4, strokeWidth: 1.5, stroke: "#f8fafc" }}
                  connectNulls={true}
                  isAnimationActive={false}
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AnalysisResultsWizard({
  step,
  clData,
  cdData,
  residualData,
  onStepChange,
  onBackToGeometry,
  onExit,
}: AnalysisResultsWizardProps) {
  const { setResultsWizardOpen } = useAppLayout();
  const [plotStyle, setPlotStyle] = useState<PlotStyle>("Both");
  const [gridMode, setGridMode] = useState<GridMode>("X Axis");
  const [showMean, setShowMean] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [xAxisLabel, setXAxisLabel] = useState("Angle of Attack [deg]");
  const [yAxisLabel, setYAxisLabel] = useState("Lift Coefficient [CL]");
  const residualSeries = useMemo(
    () =>
      (residualData?.series ?? []).map((series, index) => ({
        key: series.key,
        label: series.label,
        color: residualColorFor(series.key, index),
      })),
    [residualData]
  );
  const [visibleResidualSeries, setVisibleResidualSeries] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setResultsWizardOpen(true);
    return () => setResultsWizardOpen(false);
  }, [setResultsWizardOpen]);

  const stepIndex = STEPS.findIndex((candidate) => candidate.key === step);
  const activeStep = STEPS[Math.max(stepIndex, 0)]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const residualRows = useMemo(() => buildResidualRows(residualData), [residualData]);

  useEffect(() => {
    setPlotStyle("Both");
    setGridMode("X Axis");
    setShowMean(true);
    setShowConfidence(true);
    setShowMarkers(true);
    if (step === "cl") {
      setXAxisLabel("Angle of Attack [deg]");
      setYAxisLabel("Lift Coefficient [CL]");
    } else if (step === "cd") {
      setXAxisLabel("Angle of Attack [deg]");
      setYAxisLabel("Drag Coefficient [CD]");
    } else {
      setXAxisLabel(residualData?.xLabel || "Iteration");
      setYAxisLabel(residualData?.yLabel || "Residual");
    }
  }, [step, residualData]);

  useEffect(() => {
    if (!residualSeries.length) {
      setVisibleResidualSeries({});
      return;
    }
    setVisibleResidualSeries((current) => {
      const next: Record<string, boolean> = {};
      for (const series of residualSeries) {
        next[series.key] = current[series.key] ?? true;
      }
      return next;
    });
  }, [residualSeries]);

  const goNext = () => {
    if (isLast) {
      onBackToGeometry();
      return;
    }
    onStepChange(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.key);
  };

  const goPrev = () => {
    if (isFirst) {
      onBackToGeometry();
      return;
    }
    onStepChange(STEPS[Math.max(0, stepIndex - 1)]!.key);
  };

  if (typeof document === "undefined") return null;

  const activeChartData = activeStep.key === "cl" ? clData : cdData;
  const pointCount = activeChartData.length;
  const aoaMin = pointCount ? Math.min(...activeChartData.map((row) => row.AOA)) : null;
  const aoaMax = pointCount ? Math.max(...activeChartData.map((row) => row.AOA)) : null;
  const valueMin = pointCount ? Math.min(...activeChartData.map((row) => row.Mean)) : null;
  const valueMax = pointCount ? Math.max(...activeChartData.map((row) => row.Mean)) : null;
  const activeSeriesColor = activeStep.key === "cd" ? "#d92525" : "#2563eb";
  const activeBandColor =
    activeStep.key === "cd" ? "rgba(239, 68, 68, 0.28)" : "rgba(59, 130, 246, 0.26)";

  const renderCoefficientWorkspace = () => (
    <div className="analysis-results-wizard__workspace">
      <aside className="analysis-results-wizard__details-panel">
        <div className="analysis-results-wizard__details-heading">Details of Chart 1</div>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Chart Controls</div>
          <div className="analysis-results-wizard__property-grid">
            <div className="analysis-results-wizard__property-label">X Axis</div>
            <div className="analysis-results-wizard__property-value">AOA</div>
            <div className="analysis-results-wizard__property-label">Plot Style</div>
            <select
              className="analysis-results-wizard__property-select"
              value={plotStyle}
              onChange={(event) => setPlotStyle(event.target.value as PlotStyle)}
            >
              <option value="Both">Both</option>
              <option value="Line">Line</option>
            </select>
            <div className="analysis-results-wizard__property-label">Scale</div>
            <div className="analysis-results-wizard__property-value">Linear</div>
            <div className="analysis-results-wizard__property-label">Gridlines</div>
            <select
              className="analysis-results-wizard__property-select"
              value={gridMode}
              onChange={(event) => setGridMode(event.target.value as GridMode)}
            >
              <option value="None">None</option>
              <option value="X Axis">X Axis</option>
              <option value="Both">Both</option>
            </select>
          </div>
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Axis Labels</div>
          <label className="analysis-results-wizard__axis-field">
            <span>X-Axis</span>
            <input value={xAxisLabel} onChange={(event) => setXAxisLabel(event.target.value)} />
          </label>
          <label className="analysis-results-wizard__axis-field">
            <span>Y-Axis</span>
            <input value={yAxisLabel} onChange={(event) => setYAxisLabel(event.target.value)} />
          </label>
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Output Quantities</div>
          <label className="analysis-results-wizard__series-toggle">
            <input
              type="checkbox"
              checked={showMean}
              onChange={() => setShowMean((value) => !value)}
            />
            <span
              className="analysis-results-wizard__series-swatch"
              style={{ background: activeSeriesColor }}
            />
            <span>{activeStep.key === "cl" ? "Lift Mean" : "Drag Mean"}</span>
          </label>
          <label className="analysis-results-wizard__series-toggle">
            <input
              type="checkbox"
              checked={showConfidence}
              onChange={() => setShowConfidence((value) => !value)}
            />
            <span
              className="analysis-results-wizard__series-swatch analysis-results-wizard__series-swatch--band"
              style={{ background: activeBandColor }}
            />
            <span>95% Confidence</span>
          </label>
          <label className="analysis-results-wizard__series-toggle">
            <input
              type="checkbox"
              checked={showMarkers}
              onChange={() => setShowMarkers((value) => !value)}
            />
            <span className="analysis-results-wizard__series-swatch analysis-results-wizard__series-swatch--marker" />
            <span>Point Markers</span>
          </label>
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Report</div>
          <div className="analysis-results-wizard__stats-grid">
            <div>Content</div>
            <div>Chart And Tabular Data</div>
            <div>Points</div>
            <div>{pointCount || "Preview"}</div>
            <div>AOA Range</div>
            <div>
              {aoaMin !== null && aoaMax !== null
                ? `${aoaMin.toFixed(2)} to ${aoaMax.toFixed(2)}`
                : "Not loaded"}
            </div>
            <div>Value Range</div>
            <div>
              {valueMin !== null && valueMax !== null
                ? `${valueMin.toFixed(3)} to ${valueMax.toFixed(3)}`
                : "Not loaded"}
            </div>
          </div>
        </section>
      </aside>

      <section className="analysis-results-wizard__graph-panel">
        <div className="analysis-results-wizard__graph-toolbar">
          <span>Graph</span>
          <span>{activeStep.label}</span>
          <span>{plotStyle}</span>
        </div>
        <UQChart
          data={activeChartData}
          title={activeStep.key === "cl" ? "Lift coefficient graph" : "Drag coefficient graph"}
          yLabel={yAxisLabel}
          color={activeSeriesColor}
          ciFillColor={activeBandColor}
          isDashed={activeStep.key === "cd"}
          theme="ansys"
          options={{
            showMean,
            showCI: showConfidence,
            showMarkers,
            gridMode: gridMode === "Both" ? "both" : gridMode === "X Axis" ? "x" : "none",
            plotStyle: plotStyle === "Both" ? "both" : "line",
            xAxisLabel,
            yAxisLabel,
            meanLabel: activeStep.key === "cl" ? "Lift Mean" : "Drag Mean",
            ciLabel: "95% Confidence",
          }}
        />
        {pointCount === 0 && (
          <div className="analysis-results-wizard__chart-note">
            No CL/CD data was returned for this case, so the chart layout is visible but no graph points can be plotted yet.
          </div>
        )}
      </section>
    </div>
  );

  const renderResidualWorkspace = () => (
    <div className="analysis-results-wizard__workspace">
      <aside className="analysis-results-wizard__details-panel">
        <div className="analysis-results-wizard__details-heading">Details of Chart 1</div>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Chart Controls</div>
          <div className="analysis-results-wizard__property-grid">
            <div className="analysis-results-wizard__property-label">X Axis</div>
            <div className="analysis-results-wizard__property-value">{residualData?.xLabel || "Iteration"}</div>
            <div className="analysis-results-wizard__property-label">Plot Style</div>
            <div className="analysis-results-wizard__property-value">Line</div>
            <div className="analysis-results-wizard__property-label">Scale</div>
            <div className="analysis-results-wizard__property-value">Linear</div>
            <div className="analysis-results-wizard__property-label">Gridlines</div>
            <select
              className="analysis-results-wizard__property-select"
              value={gridMode}
              onChange={(event) => setGridMode(event.target.value as GridMode)}
            >
              <option value="None">None</option>
              <option value="X Axis">X Axis</option>
              <option value="Both">Both</option>
            </select>
          </div>
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Axis Labels</div>
          <label className="analysis-results-wizard__axis-field">
            <span>X-Axis</span>
            <input value={xAxisLabel} onChange={(event) => setXAxisLabel(event.target.value)} />
          </label>
          <label className="analysis-results-wizard__axis-field">
            <span>Y-Axis</span>
            <input value={yAxisLabel} onChange={(event) => setYAxisLabel(event.target.value)} />
          </label>
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Output Quantities</div>
          {residualSeries.length ? (
            residualSeries.map((series) => (
              <label key={series.key} className="analysis-results-wizard__series-toggle">
                <input
                  type="checkbox"
                  checked={visibleResidualSeries[series.key] ?? true}
                  onChange={() =>
                    setVisibleResidualSeries((current) => ({
                      ...current,
                      [series.key]: !(current[series.key] ?? true),
                    }))
                  }
                />
                <span
                  className="analysis-results-wizard__series-swatch"
                  style={{ background: series.color }}
                />
                <span>{series.label}</span>
              </label>
            ))
          ) : (
            <div className="analysis-results-wizard__property-value">No residual series found</div>
          )}
        </section>

        <section className="analysis-results-wizard__details-section">
          <div className="analysis-results-wizard__details-title">Report</div>
          <div className="analysis-results-wizard__stats-grid">
            <div>Content</div>
            <div>Chart And Tabular Data</div>
            <div>Series</div>
            <div>{residualSeries.length}</div>
            <div>Source</div>
            <div>{residualData?.source || "Not loaded"}</div>
          </div>
        </section>
      </aside>

      <section className="analysis-results-wizard__graph-panel">
        <div className="analysis-results-wizard__graph-toolbar">
          <span>Graph</span>
          <span>Residual history</span>
          <span>{residualData?.source || "No data"}</span>
        </div>
        {residualRows.length && residualSeries.length ? (
          <ResidualChart
            data={residualRows}
            series={residualSeries}
            gridMode={gridMode}
            visibleSeries={visibleResidualSeries}
            xAxisLabel={xAxisLabel}
            yAxisLabel={yAxisLabel}
          />
        ) : (
          <div className="analysis-results-wizard__chart-note">
            No residual history was found in this uploaded case. Add the solver log file used by `Residuals.txt` or export residual data into the archive to plot this page.
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(
    <div
      className="analysis-results-wizard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analysis-wizard-title"
    >
      <header className="analysis-results-wizard__header">
        <div>
          <h2 id="analysis-wizard-title" className="analysis-results-wizard__title">
            Uncertainty results
          </h2>
          <p className="analysis-results-wizard__subtitle">
            Step {stepIndex + 1} of {STEPS.length}: {activeStep.label}
          </p>
        </div>
        <div className="analysis-results-wizard__header-actions">
          <nav className="analysis-results-wizard__dots" aria-label="Result steps">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className={`analysis-results-wizard__dot ${
                  i === stepIndex ? "analysis-results-wizard__dot--active" : ""
                }`}
                onClick={() => onStepChange(s.key)}
                aria-label={`Go to ${s.label}`}
                aria-current={i === stepIndex ? "step" : undefined}
              />
            ))}
          </nav>
          <button
            type="button"
            className="analysis-results-wizard__btn secondary analysis-results-wizard__exit-btn"
            onClick={onExit}
          >
            Exit
          </button>
        </div>
      </header>

      <div className="analysis-results-wizard__body">
        {activeStep.key === "cl" || activeStep.key === "cd"
          ? renderCoefficientWorkspace()
          : renderResidualWorkspace()}
      </div>

      <footer className="analysis-results-wizard__footer">
        <button
          type="button"
          className="analysis-results-wizard__btn secondary"
          onClick={goPrev}
        >
          {isFirst ? "Back to geometry" : "Back"}
        </button>
        <button
          type="button"
          className="analysis-results-wizard__btn primary"
          onClick={goNext}
        >
          {isLast ? "Done (Geometry)" : "Next"}
        </button>
      </footer>
    </div>,
    document.body
  );
}
