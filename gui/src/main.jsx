import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";
import { ResearchStudy, ResearchHelp } from "./Research2027.jsx";
import { TopologyPlayback,baselineReplay } from "./ExperimentVisuals.jsx";
import {ExperimentLayout,ExperimentPanel as Panel,ExperimentKpi as Kpi,ExperimentParameterTooltip as ParameterTooltip,ExperimentProgress as ProgressStrip} from "./ExperimentLayout.jsx";

const METHODS = {
  arithmetic_mean: "Арифметическое среднее",
  trust_weighted_mean: "Среднее с учетом доверия",
  proposed_robust: "Предлагаемое робастное решение",
};

const SHORT_METHODS = {
  arithmetic_mean: "Среднее",
  trust_weighted_mean: "С учетом доверия",
  proposed_robust: "Робастное",
};

const COLORS = {
  arithmetic_mean: "#2672ff",
  trust_weighted_mean: "#079b91",
  proposed_robust: "#123a63",
  danger: "#ef6558",
  warning: "#f0be37",
  grid: "#e6eaef",
  violet: "#7657c8",
};

const DEFAULT_CONFIG = {
  seed: 20260716,
  n_agents: 50,
  n_byzantine: 10,
  n_sybil_agents: 0,
  sybil_activation_step: 20,
  n_steps: 200,
  n_runs: 100,
  n_sensitivity_runs: 20,
  factorial_runs_per_point: 6,
  factorial_max_points: 64,
  bootstrap_samples: 1000,
  parallel_workers: 0,
  desired_action: 0.6,
  attack_start_step: 20,
  attack_direction: -1,
  honest_quality: 0.92,
  byzantine_quality: 0.1,
  honest_noise_sigma: 0.2,
  observer_noise_sigma: 0.02,
  static_bias: 4,
  subtle_bias: 0.65,
  collusion_bias: 1.5,
  on_off_period: 10,
  on_off_attack_steps: 4,
  trust_window_steps: 20,
  forgetting_factor: 0.95,
  initial_trust: 0.5,
  trust_prior_strength: 2,
  minimum_weight: 0.05,
  reputation_damping: 0.85,
  isolation_threshold: 0.25,
  isolation_patience: 3,
  minimum_evidence_steps: 8,
  isolation_cooldown_steps: 30,
  trim_each_side: 10,
  clip_radius: 1.25,
  safe_action_min: -2,
  safe_action_max: 2,
  correctness_tolerance: 0.5,
  network_enabled: false,
  network_topology: "complete",
  network_edge_probability: 0.25,
  small_world_neighbors: 4,
  small_world_rewire_probability: 0.1,
  message_loss_probability: 0,
  message_delay_min_steps: 0,
  message_delay_max_steps: 0,
  max_message_staleness_steps: 5,
  bandwidth_messages_per_step: 100000,
  partition_enabled: false,
  partition_start_step: 70,
  partition_end_step: 110,
  partition_fraction: 0.5,
};

const PARAMETER_TOOLTIPS = {
  n_agents: "Общее число легитимных агентов в модели. Чем больше N, тем устойчивее честное большинство, но тем дольше расчет и сложнее сетевое взаимодействие.",
  n_byzantine: "Число византийских агентов, которые могут выдавать искаженные значения. Рост f повышает ошибку консенсуса и усложняет обнаружение атак.",
  n_steps: "Длительность одного прогона в дискретных шагах. Большое T лучше показывает динамику доверия, изоляции и восстановления после атаки.",
  n_runs: "Число независимых прогонов в серии Монте-Карло. Больше прогонов дают стабильнее статистику и доверительные интервалы, но увеличивают время расчета.",
  scenario: "Тип поведения нарушителей. Сценарий определяет форму атаки: постоянное смещение, слабое скрытое смещение, согласованную атаку или периодическое включение.",
  attack_start_step: "Шаг, с которого нарушители начинают искажать предложения. Более ранняя атака дольше влияет на доверие, репутацию и итоговую ошибку.",
  attack_intensity: "Готовый уровень силы атаки. Повышает величины смещений нарушителей, поэтому обычно снижает точность и вероятность правильного решения.",
  trust_window_steps: "Сколько последних шагов используется при оценке доверия. Большое окно сглаживает случайный шум, малое быстрее реагирует на смену поведения.",
  forgetting_factor: "Скорость уменьшения веса старых свидетельств. Чем выше λ, тем быстрее система забывает прошлое и тем чувствительнее становится к новым наблюдениям.",
  initial_trust: "Стартовое доверие к агентам до накопления свидетельств. Высокое значение медленнее наказывает нарушителей, низкое делает систему изначально осторожной.",
  minimum_weight: "Минимальный вес агента при агрегировании. Не дает полностью обнулить вклад агента, но слишком высокий минимум ослабляет защиту от нарушителей.",
  isolation_threshold: "Порог репутации для перевода агента в изоляцию. Высокий порог изолирует агрессивнее, низкий снижает риск ложных изоляций.",
  isolation_patience: "Сколько раз подряд агент должен быть ниже порога перед изоляцией. Большое k уменьшает ложные срабатывания, но замедляет реакцию на атаку.",
  isolation_cooldown_steps: "Минимальное время до восстановления изолированного агента. Большое значение дольше удерживает нарушителей вне решения, но медленнее возвращает ошибочно изолированных.",
  network_enabled: "Включает ограничения сетевой доставки сообщений. При включении доверие строится только по доступным наблюдениям, поэтому потери и разделения сильнее влияют на результат.",
  n_sybil_agents: "Число ложных Sybil-идентичностей. Увеличивает эффективную долю нарушителей и может разрушить честное большинство.",
  sybil_activation_step: "Шаг появления Sybil-идентичностей. Поздняя активация проверяет, успела ли система накопить доверие до усиления атаки.",
  network_topology: "Структура связей между агентами. Топология влияет на доступность наблюдений, связность сети и скорость распространения искажений.",
  network_edge_probability: "Вероятность ребра в случайном графе. Меньшее значение делает сеть разреженной и ухудшает доставку наблюдений.",
  small_world_neighbors: "Число соседей в модели малого мира. Больше соседей повышает связность и надежность доставки, но приближает сеть к плотной.",
  small_world_rewire_probability: "Вероятность перенаправления ребер в топологии малого мира. Рост значения добавляет дальние связи и меняет баланс локальности и связности.",
  message_loss_probability: "Вероятность потери каждого сообщения. Рост потерь уменьшает число свидетельств, снижает качество доверия и может задерживать обнаружение.",
  message_delay_min_steps: "Минимальная задержка доставки сообщения в шагах. Задержки делают наблюдения менее актуальными.",
  message_delay_max_steps: "Максимальная задержка доставки сообщения. Большой разброс задержек увеличивает устаревание данных и шум в оценке доверия.",
  max_message_staleness_steps: "Максимально допустимый возраст сообщения. Малое значение отбрасывает больше старых наблюдений, большое допускает менее актуальные свидетельства.",
  bandwidth_messages_per_step: "Лимит сообщений, доставляемых за шаг. Низкая пропускная способность создает конкуренцию сообщений и снижает полноту наблюдений.",
  partition_enabled: "Включает временное разделение сети на сегменты. Разделение снижает связность и проверяет устойчивость метода при частичной видимости.",
  partition_start_step: "Шаг начала разделения сети. Если разделение совпадает с атакой, влияние нарушителей обычно усиливается.",
  partition_end_step: "Шаг завершения разделения сети. Длинное разделение дольше ограничивает обмен наблюдениями.",
  partition_fraction: "Доля узлов в отделенном сегменте. Определяет масштаб нарушения связности и доставки сообщений.",
  bootstrap_samples: "Число bootstrap-перевыборок для интервалов сравнения методов. Больше выборок стабильнее, но медленнее.",
  parallel_workers: "Число параллельных процессов. Значение 0 выбирает автоматически; больше процессов ускоряют серии при наличии CPU-ресурсов.",
  n_sensitivity_runs: "Число прогонов для каждой точки однофакторного анализа. Больше прогонов уменьшают случайный разброс оценки чувствительности.",
  factorial_runs_per_point: "Число прогонов на точку многофакторного плана. Повышает надежность оценки главных эффектов и взаимодействий.",
  factorial_max_points: "Максимум точек многофакторного плана. Больше точек покрывают больше комбинаций факторов, но резко увеличивают время расчета.",
  desired_action: "Истинное или желаемое скалярное действие, относительно которого считается ошибка. Сдвиг меняет базовую цель консенсуса.",
  honest_noise_sigma: "Стандартное отклонение шума корректных агентов. Больший шум затрудняет отличить честные ошибки от атаки.",
  reputation_damping: "Коэффициент демпфирования EigenTrust. Высокое значение сильнее учитывает сетевую репутацию, низкое быстрее ослабляет ее влияние.",
  minimum_evidence_steps: "Минимум наблюдений перед уверенной оценкой агента. Большое значение снижает поспешные решения, но замедляет детекцию.",
  trim_each_side: "Сколько крайних значений отбрасывается с каждой стороны при усеченном среднем. Рост повышает робастность к выбросам, но может терять полезные честные данные.",
  clip_radius: "Радиус ограничения выбросов вокруг центральной оценки. Малое значение жестче ограничивает экстремальные предложения, большое пропускает больше вариативности.",
  correctness_tolerance: "Допустимое отклонение от истинного действия для метрики правильного решения. Большой допуск повышает P(правильное решение), малый делает критерий строже.",
};

const SCENARIOS = [
  ["collusion", "Согласованная (злонамеренная координация)"],
  ["static_bias", "Постоянное сильное смещение"],
  ["subtle_bias", "Малозаметное смещение"],
  ["on_off", "Периодическая on-off-атака"],
];

const ATTACK_LEVELS = {
  low: { label: "Низкая", static_bias: 0.8, subtle_bias: 0.2, collusion_bias: 0.5 },
  medium: { label: "Средняя", static_bias: 2, subtle_bias: 0.4, collusion_bias: 0.9 },
  high: { label: "Высокая", static_bias: 4, subtle_bias: 0.65, collusion_bias: 1.5 },
};

const METRIC_LABELS = {
  rmse_to_truth: "RMSE",
  mae_to_truth: "MAE",
  probability_correct: "P(правильное решение)",
  consensus_error: "Ошибка консенсуса",
  detection_rate: "Полнота обнаружения",
  mean_detection_time_steps: "Время обнаружения",
  delivery_ratio: "Доля доставленных сообщений",
};

const FACTOR_LABELS = {
  n_byzantine: "Число нарушителей f",
  isolation_threshold: "Порог изоляции τiso",
  trust_window_steps: "Окно доверия",
  forgetting_factor: "Коэффициент забывания",
  attack_intensity_multiplier: "Интенсивность атаки",
  honest_noise_sigma: "Шум корректных агентов",
};

function Icon({ name }) {
  const paths = {
    play: <path d="M7 4.8 18.4 12 7 19.2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />,
    reset: <path d="M5 8V4m0 0h4M5 4l3.2 3.2A7 7 0 1 1 5.6 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    seed: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
    download: <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    export: <path d="M12 15V4m0 0 4 4m-4-4L8 8M5 13v7h14v-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    fullscreen: <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    help: <><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M9.8 9.1a2.4 2.4 0 1 1 3.7 2c-1 .6-1.5 1.1-1.5 2.2M12 17h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function FieldLabel({ label, tooltip }) {
  return <span className="field-label"><span>{label}</span><ParameterTooltip text={tooltip} /></span>;
}

function NumberField({ label, value, min, max, step = 1, onChange, hint, id, tooltip }) {
  return (
    <label className="field" htmlFor={id}>
      <FieldLabel label={label} tooltip={tooltip} />
      <input id={id} aria-label={label} type="number" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function SelectField({ label, value, onChange, children, tooltip }) {
  return <label className="field"><FieldLabel label={label} tooltip={tooltip} /><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function BoolField({ label, checked, onChange, hint, tooltip }) {
  return <label className="bool-field"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="bool-label"><span>{label}</span><ParameterTooltip text={tooltip} />{hint ? <small>{hint}</small> : null}</span></label>;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} мин ${seconds % 60} с` : `${seconds} с`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildReputationChart(rows, nAgents) {
  const map = new Map();
  rows.forEach((row) => {
    const item = map.get(row.step) || { step: row.step, honestValues: [], byzantineValues: [], sybilValues: [] };
    item[`a${row.agent}`] = row.reputation;
    item[row.sybil ? "sybilValues" : row.byzantine ? "byzantineValues" : "honestValues"].push(row.reputation);
    map.set(row.step, item);
  });
  const chart = [...map.values()].map((item) => ({ ...item, honestMean: average(item.honestValues), byzantineMean: average(item.byzantineValues), sybilMean: average(item.sybilValues) }));
  const types = new Map();
  rows.filter((row) => row.step === 1).forEach((row) => types.set(row.agent, row.sybil ? "sybil" : row.byzantine ? "byzantine" : "honest"));
  return { chart, types, agents: Array.from({ length: nAgents }, (_, index) => index + 1) };
}

function StateHeatmap({ states, agents, steps }) {
  const stride = Math.max(1, Math.ceil(steps / 80));
  const sampledSteps = Array.from({ length: Math.ceil(steps / stride) }, (_, index) => Math.min(steps, index * stride + 1));
  const lookup = useMemo(() => new Map(states.map((item) => [`${item.agent}-${item.step}`, item.state])), [states]);
  return (
    <div className="heatmap-wrap">
      <div className="heatmap" style={{ gridTemplateColumns: `38px repeat(${sampledSteps.length}, minmax(3px, 1fr))` }}>
        <div />
        {sampledSteps.map((step, index) => <div className="heat-label top" key={`s-${step}`}>{index % 10 === 0 ? step : ""}</div>)}
        {Array.from({ length: agents }, (_, index) => index + 1).flatMap((agent) => [
          <div className="heat-label" key={`l-${agent}`}>{agent}</div>,
          ...sampledSteps.map((step) => {
            const state = lookup.get(`${agent}-${step}`) || "honest";
            return <div className={`heat-cell ${state}`} title={`Агент ${agent}; шаг ${step}; состояние: ${state}`} key={`${agent}-${step}`} />;
          }),
        ])}
      </div>
      <div className="heat-legend"><span><i className="honest" />Корректный</span><span><i className="byzantine" />Византийский</span><span><i className="sybil" />Sybil</span><span><i className="isolated" />Изолирован</span><span><i className="dormant" />Не активирован</span></div>
    </div>
  );
}

function Sidebar({ config, setConfig, scenario, setScenario, attackLevel, setAttackLevel, onRun, running }) {
  const set = (key) => (value) => setConfig((current) => ({ ...current, [key]: value }));
  const ratio = ((config.n_byzantine / Math.max(config.n_agents, 1)) * 100).toFixed(1);
  const effectiveTotal = config.n_agents + config.n_sybil_agents;
  const effectiveBad = config.n_byzantine + config.n_sybil_agents;
  const honestMajority = effectiveTotal > 2 * effectiveBad;
  const updateAgents = (value) => setConfig((current) => {
    const n = Math.max(3, value);
    const maxBad = Math.floor((n - 1) / 2);
    return { ...current, n_agents: n, n_byzantine: Math.min(current.n_byzantine, maxBad), trim_each_side: Math.min(current.trim_each_side, maxBad) };
  });
  const updateSteps = (value) => setConfig((current) => ({
    ...current,
    n_steps: value,
    attack_start_step: Math.min(current.attack_start_step, value),
    sybil_activation_step: Math.min(current.sybil_activation_step, value),
    partition_start_step: Math.min(current.partition_start_step, value),
    partition_end_step: Math.min(Math.max(current.partition_end_step, current.partition_start_step), value),
  }));
  const changeLevel = (value) => {
    const level = ATTACK_LEVELS[value];
    setAttackLevel(value);
    setConfig((current) => ({ ...current, static_bias: level.static_bias, subtle_bias: level.subtle_bias, collusion_bias: level.collusion_bias }));
  };
  return (
    <aside className="sidebar r27-unified-settings">
      <div className="sidebar-scroll">
        <h2>Параметры эксперимента</h2>
        <NumberField label="N — число легитимных агентов" value={config.n_agents} min={3} max={120} onChange={updateAgents} tooltip={PARAMETER_TOOLTIPS.n_agents} />
        <NumberField label="f — число византийских агентов" value={config.n_byzantine} min={0} max={Math.floor((config.n_agents - 1) / 2)} onChange={(value) => setConfig((current) => ({ ...current, n_byzantine: value, trim_each_side: value }))} hint={`f/N = ${ratio} %`} tooltip={PARAMETER_TOOLTIPS.n_byzantine} />
        <div className="two-fields"><NumberField label="Число шагов (T)" value={config.n_steps} min={20} max={500} onChange={updateSteps} tooltip={PARAMETER_TOOLTIPS.n_steps} /><NumberField label="Число прогонов" value={config.n_runs} min={2} max={500} onChange={set("n_runs")} tooltip={PARAMETER_TOOLTIPS.n_runs} /></div>

        <div className="sidebar-section">
          <h3>Сценарий атаки</h3>
          <SelectField label="Сценарий" value={scenario} onChange={setScenario} tooltip={PARAMETER_TOOLTIPS.scenario}>{SCENARIOS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</SelectField>
          <NumberField label="Время начала атаки (шаг)" value={config.attack_start_step} min={1} max={config.n_steps} onChange={set("attack_start_step")} tooltip={PARAMETER_TOOLTIPS.attack_start_step} />
          <SelectField label="Интенсивность атаки" value={attackLevel} onChange={changeLevel} tooltip={PARAMETER_TOOLTIPS.attack_intensity}>{Object.entries(ATTACK_LEVELS).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}</SelectField>
        </div>

        <div className="sidebar-section">
          <h3>Параметры доверия</h3>
          <NumberField label="Окно наблюдения (шагов)" value={config.trust_window_steps} min={2} max={100} onChange={set("trust_window_steps")} tooltip={PARAMETER_TOOLTIPS.trust_window_steps} />
          <NumberField label="Скорость забывания (λ)" value={Number((1 - config.forgetting_factor).toFixed(3))} min={0} max={0.4} step={0.01} onChange={(value) => set("forgetting_factor")(1 - value)} tooltip={PARAMETER_TOOLTIPS.forgetting_factor} />
          <NumberField label="Начальное доверие (w₀)" value={config.initial_trust} min={0.05} max={0.95} step={0.05} onChange={set("initial_trust")} tooltip={PARAMETER_TOOLTIPS.initial_trust} />
          <NumberField label="Минимальный вес (wmin)" value={config.minimum_weight} min={0} max={0.5} step={0.01} onChange={set("minimum_weight")} tooltip={PARAMETER_TOOLTIPS.minimum_weight} />
        </div>

        <div className="sidebar-section">
          <h3>Параметры изоляции</h3>
          <NumberField label="Порог изоляции (τiso)" value={config.isolation_threshold} min={0.05} max={0.9} step={0.01} onChange={set("isolation_threshold")} tooltip={PARAMETER_TOOLTIPS.isolation_threshold} />
          <NumberField label="Подтверждений для изоляции (k)" value={config.isolation_patience} min={1} max={20} onChange={set("isolation_patience")} tooltip={PARAMETER_TOOLTIPS.isolation_patience} />
          <NumberField label="Охлаждение изоляции (шагов)" value={config.isolation_cooldown_steps} min={1} max={100} onChange={set("isolation_cooldown_steps")} tooltip={PARAMETER_TOOLTIPS.isolation_cooldown_steps} />
        </div>

        <details className="advanced network-settings">
          <summary>Сетевая модель и Sybil-атака</summary>
          <div className="advanced-body">
            <BoolField label="Учитывать сетевые ограничения" checked={config.network_enabled} onChange={set("network_enabled")} tooltip={PARAMETER_TOOLTIPS.network_enabled} />
            <NumberField label="Число Sybil-идентичностей" value={config.n_sybil_agents} min={0} max={40} onChange={set("n_sybil_agents")} hint={`Итого ${effectiveTotal} агентов; нарушителей ${effectiveBad}. ${honestMajority ? "Честное большинство сохранено" : "Честное большинство нарушено"}`} tooltip={PARAMETER_TOOLTIPS.n_sybil_agents} />
            {config.n_sybil_agents > 0 ? <NumberField label="Активация Sybil (шаг)" value={config.sybil_activation_step} min={1} max={config.n_steps} onChange={set("sybil_activation_step")} tooltip={PARAMETER_TOOLTIPS.sybil_activation_step} /> : null}
            {config.network_enabled ? <>
              <SelectField label="Топология" value={config.network_topology} onChange={set("network_topology")} tooltip={PARAMETER_TOOLTIPS.network_topology}><option value="complete">Полносвязная</option><option value="ring">Кольцевая</option><option value="random">Случайный граф</option><option value="small_world">Малый мир</option></SelectField>
              {config.network_topology === "random" ? <NumberField label="Вероятность ребра" value={config.network_edge_probability} min={0.02} max={1} step={0.01} onChange={set("network_edge_probability")} tooltip={PARAMETER_TOOLTIPS.network_edge_probability} /> : null}
              {config.network_topology === "small_world" ? <><NumberField label="Число соседей k" value={config.small_world_neighbors} min={2} max={20} step={2} onChange={set("small_world_neighbors")} tooltip={PARAMETER_TOOLTIPS.small_world_neighbors} /><NumberField label="Вероятность перенаправления" value={config.small_world_rewire_probability} min={0} max={1} step={0.01} onChange={set("small_world_rewire_probability")} tooltip={PARAMETER_TOOLTIPS.small_world_rewire_probability} /></> : null}
              <NumberField label="Вероятность потери сообщения" value={config.message_loss_probability} min={0} max={1} step={0.01} onChange={set("message_loss_probability")} tooltip={PARAMETER_TOOLTIPS.message_loss_probability} />
              <div className="two-fields"><NumberField label="Мин. задержка" value={config.message_delay_min_steps} min={0} max={20} onChange={set("message_delay_min_steps")} tooltip={PARAMETER_TOOLTIPS.message_delay_min_steps} /><NumberField label="Макс. задержка" value={config.message_delay_max_steps} min={config.message_delay_min_steps} max={20} onChange={set("message_delay_max_steps")} tooltip={PARAMETER_TOOLTIPS.message_delay_max_steps} /></div>
              <NumberField label="Допустимая устарелость" value={config.max_message_staleness_steps} min={0} max={50} onChange={set("max_message_staleness_steps")} tooltip={PARAMETER_TOOLTIPS.max_message_staleness_steps} />
              <NumberField label="Пропускная способность, сообщ./шаг" value={config.bandwidth_messages_per_step} min={1} max={1000000} onChange={set("bandwidth_messages_per_step")} tooltip={PARAMETER_TOOLTIPS.bandwidth_messages_per_step} />
              <BoolField label="Моделировать разделение сети" checked={config.partition_enabled} onChange={set("partition_enabled")} tooltip={PARAMETER_TOOLTIPS.partition_enabled} />
              {config.partition_enabled ? <><div className="two-fields"><NumberField label="Начало разделения" value={config.partition_start_step} min={1} max={config.n_steps} onChange={set("partition_start_step")} tooltip={PARAMETER_TOOLTIPS.partition_start_step} /><NumberField label="Конец разделения" value={config.partition_end_step} min={config.partition_start_step} max={config.n_steps} onChange={set("partition_end_step")} tooltip={PARAMETER_TOOLTIPS.partition_end_step} /></div><NumberField label="Доля узлов в сегменте" value={config.partition_fraction} min={0.05} max={0.95} step={0.05} onChange={set("partition_fraction")} tooltip={PARAMETER_TOOLTIPS.partition_fraction} /></> : null}
            </> : null}
          </div>
        </details>

        <details className="advanced">
          <summary>Статистика и вычисления</summary>
          <div className="advanced-body">
            <NumberField label="Bootstrap-выборок" value={config.bootstrap_samples} min={100} max={10000} step={100} onChange={set("bootstrap_samples")} tooltip={PARAMETER_TOOLTIPS.bootstrap_samples} />
            <NumberField label="Параллельных процессов (0 — авто)" value={config.parallel_workers} min={0} max={32} onChange={set("parallel_workers")} tooltip={PARAMETER_TOOLTIPS.parallel_workers} />
            <NumberField label="Прогонов на точку чувствительности" value={config.n_sensitivity_runs} min={1} max={100} onChange={set("n_sensitivity_runs")} tooltip={PARAMETER_TOOLTIPS.n_sensitivity_runs} />
            <NumberField label="Прогонов на точку факторного плана" value={config.factorial_runs_per_point} min={1} max={50} onChange={set("factorial_runs_per_point")} tooltip={PARAMETER_TOOLTIPS.factorial_runs_per_point} />
            <NumberField label="Максимум точек факторного плана" value={config.factorial_max_points} min={4} max={64} onChange={set("factorial_max_points")} tooltip={PARAMETER_TOOLTIPS.factorial_max_points} />
          </div>
        </details>

        <details className="advanced">
          <summary>Дополнительно</summary>
          <div className="advanced-body">
            <NumberField label="Желаемое действие x*" value={config.desired_action} min={-2} max={2} step={0.05} onChange={set("desired_action")} tooltip={PARAMETER_TOOLTIPS.desired_action} />
            <NumberField label="СКО шума корректного агента" value={config.honest_noise_sigma} min={0.01} max={1} step={0.01} onChange={set("honest_noise_sigma")} tooltip={PARAMETER_TOOLTIPS.honest_noise_sigma} />
            <NumberField label="Коэффициент EigenTrust γ" value={config.reputation_damping} min={0} max={0.99} step={0.01} onChange={set("reputation_damping")} tooltip={PARAMETER_TOOLTIPS.reputation_damping} />
            <NumberField label="Минимум наблюдений" value={config.minimum_evidence_steps} min={1} max={100} onChange={set("minimum_evidence_steps")} tooltip={PARAMETER_TOOLTIPS.minimum_evidence_steps} />
            <NumberField label="Усечение с каждой стороны" value={config.trim_each_side} min={0} max={Math.floor((config.n_agents - 1) / 2)} onChange={set("trim_each_side")} tooltip={PARAMETER_TOOLTIPS.trim_each_side} />
            <NumberField label="Радиус ограничения выбросов" value={config.clip_radius} min={0.05} max={10} step={0.05} onChange={set("clip_radius")} tooltip={PARAMETER_TOOLTIPS.clip_radius} />
            <NumberField label="Допуск правильного решения" value={config.correctness_tolerance} min={0.01} max={2} step={0.05} onChange={set("correctness_tolerance")} tooltip={PARAMETER_TOOLTIPS.correctness_tolerance} />
          </div>
        </details>
      </div>
      <button className="run-button" onClick={onRun} disabled={running}><Icon name="play" />{running ? "Выполняется…" : "Запустить эксперимент"}</button>
    </aside>
  );
}

function formatChartValue(value, name) {
  if (Array.isArray(value)) return [`${Number(value[0]).toFixed(3)} … ${Number(value[1]).toFixed(3)}`, name];
  return [Number(value).toFixed(3), name];
}

function BandControls({ hasBands, runCount, mode, setMode, showTolerance, setShowTolerance, onRunBands, running }) {
  return <div className="chart-tools">{hasBands ? <span className="stat-badge">R={runCount}; s, ddof=1; q5/q25/q75/q95</span> : <button className="inline-action" onClick={onRunBands} disabled={running}><Icon name="play" />Рассчитать области</button>}<select className="compact-select" value={mode} disabled={!hasBands} onChange={(event) => setMode(event.target.value)}><option value="sigma">±1σ/±2σ</option><option value="quantile">P25–P75/P5–P95</option><option value="both">Все области</option></select><label><input type="checkbox" checked={showTolerance} onChange={(event) => setShowTolerance(event.target.checked)} />±δ</label></div>;
}

function DecisionAreas({ hasBands, mode }) {
  if (!hasBands) return null;
  return <>{["sigma", "both"].includes(mode) ? <><Area dataKey="proposed_robust_band2" name="±2σ по прогонам" stroke="none" fill="#dcecff" fillOpacity={0.62} isAnimationActive={false} /><Area dataKey="proposed_robust_band1" name="±1σ по прогонам" stroke="none" fill="#bdd8ff" fillOpacity={0.72} isAnimationActive={false} /></> : null}{["quantile", "both"].includes(mode) ? <><Area dataKey="proposed_robust_band90" name="P5–P95" stroke="none" fill="#eadffc" fillOpacity={0.47} isAnimationActive={false} /><Area dataKey="proposed_robust_band50" name="P25–P75" stroke="none" fill="#d4c0f5" fillOpacity={0.62} isAnimationActive={false} /></> : null}</>;
}

function TimeRangeSelector({children,start,end,onZoom,onDrag}){
  const gesture=useRef(null);
  const locate=(event)=>{
    const grid=event.currentTarget.querySelector(".recharts-cartesian-grid");
    const rect=grid?.getBoundingClientRect();
    if(!rect || rect.width < 10 || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    return Math.round(start+fraction*(end-start));
  };
  const begin=event=>{
    if(event.button!==0 || end<=start)return;
    const step=locate(event);
    if(step===null)return;
    gesture.current={from:step,to:step};
    onDrag([step,step]);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move=event=>{
    if(!gesture.current)return;
    const grid=event.currentTarget.querySelector(".recharts-cartesian-grid");
    const rect=grid?.getBoundingClientRect();
    if(!rect || rect.width<10)return;
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const step=Math.round(start+fraction*(end-start));
    gesture.current.to=step;
    onDrag([gesture.current.from,step]);
  };
  const finish=event=>{
    const current=gesture.current;
    if(!current)return;
    move(event);
    const a=Math.min(current.from,current.to),b=Math.max(current.from,current.to);
    gesture.current=null;
    onDrag(null);
    if(b>a)onZoom(a,b);
    if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const cancel=()=>{
    gesture.current=null;
    onDrag(null);
  };
  return <div className="trust-zoom-surface" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
    {children}
  </div>;
}

function SingleRun({ data, config, trajectoryStatistics, onRunBands, running }) {
  const [bandMode, setBandMode] = useState("sigma");
  const [showTolerance, setShowTolerance] = useState(false);
  const [zoomRange, setZoomRange] = useState(null);
  const [dragRange, setDragRange] = useState(null);
  const trustReplay=useMemo(()=>baselineReplay(data,config),[data,config]);
  useEffect(()=>{setZoomRange(null);setDragRange(null);},[data]);
  if (!data) return <><TopologyPlayback replay={trustReplay} compact/><div className="empty">Запустите эксперимент для построения трассировки и расчёта показателей.</div></>;
  const robust = data.metrics.find((item) => item.method === "proposed_robust");
  const last = data.series.at(-1);
  const totalBad = data.configuration.effective_byzantine_count ?? config.n_byzantine;
  const totalAgents = data.configuration.effective_agent_count ?? config.n_agents;
  const isolated = data.agents.filter((item) => !item.active && item.isolated_at !== null).length;
  const finalRep = data.reputation.filter((item) => item.step === last.step);
  const honestTrust = average(finalRep.filter((item) => !item.byzantine).map((item) => item.reputation));
  const hasBands = Array.isArray(trajectoryStatistics) && trajectoryStatistics.length === data.series.length;
  const statisticsByStep = new Map((trajectoryStatistics || []).map((row) => [row.step, row]));
  const runCount = hasBands ? trajectoryStatistics[0]?.run_count ?? config.n_runs : 0;
  const decisionChart = data.series.map((row) => ({ ...row, tolerance_band: [row.truth - config.correctness_tolerance, row.truth + config.correctness_tolerance], ...(statisticsByStep.get(row.step) || {}) }));
  const rep = buildReputationChart(data.reputation, totalAgents);
  const allSteps = data.series.map(row => Number(row.step)).filter(Number.isFinite);
  const firstStep = Math.min(...allSteps);
  const lastStep = Math.max(...allSteps);
  const clampStep = value => Math.max(firstStep, Math.min(lastStep, Math.round(Number(value))));
  const startStep = zoomRange ? Math.max(firstStep, Math.min(lastStep, zoomRange[0])) : firstStep;
  const endStep = zoomRange ? Math.max(startStep, Math.min(lastStep, zoomRange[1])) : lastStep;
  const visibleDecision = decisionChart.filter(row => row.step >= startStep && row.step <= endStep);
  const visibleReputation = rep.chart.filter(row => row.step >= startStep && row.step <= endStep);
  const changeZoom = (from, to) => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const a = clampStep(from), b = clampStep(to);
    if (a <= b) setZoomRange([a, b]);
  };
  const zoomSelection = dragRange && dragRange[0] !== dragRange[1] ? 
    <ReferenceArea x1={Math.min(...dragRange)} x2={Math.max(...dragRange)} strokeOpacity={0.2} fill="#5195cf" fillOpacity={0.22} /> : null;

  const metricChart = [
    { metric: "RMSE (↓)", ...Object.fromEntries(data.metrics.map((item) => [item.method, item.rmse])) },
    { metric: "MAE (↓)", ...Object.fromEntries(data.metrics.map((item) => [item.method, item.mae])) },
    { metric: "Смещение |bias| (↓)", ...Object.fromEntries(data.metrics.map((item) => [item.method, Math.abs(item.bias)])) },
    { metric: "Покрытие 95% (↑)", ...Object.fromEntries(data.metrics.map((item) => [item.method, item.coverage95])) },
  ];
  const networkVisible = config.network_enabled || config.n_sybil_agents > 0 || data.summary.delivery_ratio < 0.999;
  return <>
    <div className="trust-overview-grid">
      <TopologyPlayback replay={trustReplay} compact />
      <Panel title="Сводная таблица результатов расчёта доверия" subtitle="Результаты одного прогона для всех методов агрегирования">
        <div className="table-wrap trust-summary-table"><table><thead><tr><th>Метод</th><th>RMSE</th><th>MAE</th><th>|Смещение|</th><th>Покрытие 95%</th></tr></thead>
        <tbody>{data.metrics.map(item=><tr key={item.method}><td>{METHODS[item.method]||item.method}</td><td>{item.rmse.toFixed(4)}</td><td>{item.mae.toFixed(4)}</td><td>{Math.abs(item.bias).toFixed(4)}</td><td>{(item.coverage95*100).toFixed(2)}%</td></tr>)}</tbody></table></div>
      </Panel>
    </div>
    {data.partial ? <div className="partial-banner">Отображены частичные результаты: выполнено {data.summary.completed_steps} из {config.n_steps} шагов.</div> : null}
    <div className="kpi-grid"><Kpi label={`Текущее решение (шаг ${last.step})`} value={last.proposed_robust.toFixed(3)} note="Трассировка выбранного прогона" /><Kpi label="Ошибка робастного решения (RMSE)" value={robust.rmse.toFixed(3)} note="За выбранный прогон" /><Kpi label="Изолированные нарушители/агенты" value={`${data.agents.filter((item) => item.byzantine && item.isolated_at !== null).length} / ${isolated}`} note={`Всего нарушителей: ${totalBad}`} tone="teal" /><Kpi label="Доставка сообщений" value={`${(data.summary.delivery_ratio * 100).toFixed(1)}%`} note={`Доверие корректных: ${honestTrust.toFixed(3)}`} tone="teal" /></div>
    <div className="trust-zoom-toolbar" role="group" aria-label="Общий масштаб временных графиков">
      <span className="trust-zoom-title">Общий масштаб по оси X</span>
      <label>С шага <input type="number" aria-label="Начальный шаг увеличения" min={firstStep} max={endStep} value={startStep} onChange={e=>changeZoom(Number(e.target.value),endStep)} /></label>
      <label>По шаг <input type="number" aria-label="Конечный шаг увеличения" min={startStep} max={lastStep} value={endStep} onChange={e=>changeZoom(startStep,Number(e.target.value))} /></label>
      <button type="button" className="trust-zoom-reset" onClick={()=>{setZoomRange(null);setDragRange(null);}} disabled={!zoomRange}>Показать весь интервал</button>
      <span className="trust-zoom-hint">Выделите мышью участок на любом графике — масштаб изменится на обоих</span>
    </div>
    <div className="main-grid trust-synced-grid" data-zoom-from={startStep} data-zoom-to={endStep} data-decision-points={visibleDecision.length} data-reputation-points={visibleReputation.length}>
      <Panel title="Динамика решений и оценок" subtitle={hasBands ? `Линии выбранного прогона; статистические области рассчитаны по ${runCount} независимым прогонам` : "Для межпрогонных областей выполните серию Монте-Карло."} headerAside={<BandControls hasBands={hasBands} runCount={runCount} mode={bandMode} setMode={setBandMode} showTolerance={showTolerance} setShowTolerance={setShowTolerance} onRunBands={onRunBands} running={running} />}>
        <TimeRangeSelector start={startStep} end={endStep} onZoom={changeZoom} onDrag={setDragRange}><ResponsiveContainer width="100%" height={320}><ComposedChart data={visibleDecision} margin={{ top: 12, right: 18, left: -10, bottom: 8 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="step" tick={{ fontSize: 10 }} label={{ value: "Шаг", position: "insideBottom", offset: -4, fontSize: 10 }} /><YAxis domain={[config.safe_action_min - 0.5, config.safe_action_max + 0.5]} tick={{ fontSize: 10 }} label={{ value: "Значение", angle: -90, position: "insideLeft", fontSize: 10 }} /><Tooltip contentStyle={{ fontSize: 11, borderColor: "#d8e0e8" }} formatter={formatChartValue} /><Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} />{showTolerance ? <Area dataKey="tolerance_band" name="Допустимое отклонение ±δ" stroke="none" fill="#dff4ea" fillOpacity={0.52} isAnimationActive={false} /> : null}<DecisionAreas hasBands={hasBands} mode={bandMode} /><ReferenceLine x={config.attack_start_step} stroke={COLORS.danger} strokeDasharray="4 4" label={{ value: "Начало атаки", fill: COLORS.danger, fontSize: 9, position: "insideTopRight" }} /><Line dataKey="truth" name="Желаемое действие (x*)" stroke="#7d8792" strokeDasharray="5 4" dot={false} strokeWidth={1.4} isAnimationActive={false} /><Line dataKey="arithmetic_mean" name={METHODS.arithmetic_mean} stroke={COLORS.arithmetic_mean} strokeDasharray="5 3" dot={false} strokeWidth={1.6} isAnimationActive={false} /><Line dataKey="trust_weighted_mean" name={METHODS.trust_weighted_mean} stroke={COLORS.trust_weighted_mean} dot={false} strokeWidth={1.8} isAnimationActive={false} />{hasBands ? <Line dataKey="proposed_robust_mean" name="Среднее робастное по прогонам" stroke="#6d8caf" strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} /> : null}<Line dataKey="proposed_robust" name="Робастное — выбранный прогон" stroke={COLORS.proposed_robust} dot={false} strokeWidth={2.2} isAnimationActive={false} />{zoomSelection}</ComposedChart></ResponsiveContainer></TimeRangeSelector>
      </Panel>
      <Panel title="Доверие (репутация) агентов" subtitle="Индивидуальная динамика и средние значения по группам">
        <TimeRangeSelector start={startStep} end={endStep} onZoom={changeZoom} onDrag={setDragRange}><ResponsiveContainer width="100%" height={320}><LineChart data={visibleReputation} margin={{ top: 12, right: 16, left: -10, bottom: 8 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="step" tick={{ fontSize: 10 }} /><YAxis domain={[0, 1]} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ fontSize: 10 }} formatter={(value, name) => [Number(value).toFixed(3), name]} /><ReferenceLine y={config.isolation_threshold} stroke={COLORS.trust_weighted_mean} strokeDasharray="5 4" label={{ value: "Порог изоляции", fill: COLORS.trust_weighted_mean, fontSize: 9 }} />{rep.agents.map((agent) => <Line key={agent} dataKey={`a${agent}`} name={`Агент ${agent}`} stroke={rep.types.get(agent) === "sybil" ? COLORS.violet : rep.types.get(agent) === "byzantine" ? COLORS.danger : COLORS.trust_weighted_mean} strokeOpacity={0.24} dot={false} strokeWidth={0.8} legendType="none" isAnimationActive={false} />)}<Line dataKey="honestMean" name="Корректные" stroke={COLORS.trust_weighted_mean} dot={false} strokeWidth={2.1} isAnimationActive={false} /><Line dataKey="byzantineMean" name="Византийские" stroke={COLORS.danger} dot={false} strokeWidth={2.1} isAnimationActive={false} />{config.n_sybil_agents > 0 ? <Line dataKey="sybilMean" name="Sybil" stroke={COLORS.violet} dot={false} strokeWidth={2.1} isAnimationActive={false} /> : null}<Legend wrapperStyle={{ fontSize: 10 }} />{zoomSelection}</LineChart></ResponsiveContainer></TimeRangeSelector>
      </Panel>
    </div>
    {networkVisible ? <Panel title="Сетевые ограничения и доступность данных" subtitle="Размер компоненты связности, число доступных предложений и доля доставки сообщений"><ResponsiveContainer width="100%" height={260}><LineChart data={data.network_series} margin={{ top: 12, right: 40, left: -5, bottom: 10 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="step" tick={{ fontSize: 10 }} /><YAxis yAxisId="count" domain={[0, totalAgents]} tick={{ fontSize: 9 }} /><YAxis yAxisId="ratio" orientation="right" domain={[0, 1]} tick={{ fontSize: 9 }} /><Tooltip contentStyle={{ fontSize: 10 }} /><Legend wrapperStyle={{ fontSize: 9 }} /><Line yAxisId="count" dataKey="largest_component" name="Крупнейшая компонента" stroke={COLORS.proposed_robust} dot={false} strokeWidth={2} isAnimationActive={false} /><Line yAxisId="count" dataKey="available_agents" name="Доступные предложения" stroke={COLORS.arithmetic_mean} dot={false} isAnimationActive={false} /><Line yAxisId="ratio" dataKey="delivery_ratio" name="Доля доставки" stroke={COLORS.trust_weighted_mean} dot={false} isAnimationActive={false} /><ReferenceLine yAxisId="count" x={config.partition_start_step} stroke={COLORS.warning} strokeDasharray="4 4" /></LineChart></ResponsiveContainer></Panel> : null}
    <div className="lower-grid">
      <Panel title="Сравнение методов (итоговые метрики)"><ResponsiveContainer width="100%" height={405}><BarChart data={metricChart} margin={{ top: 8, right: 8, left: -10, bottom: 30 }} barGap={1}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="metric" interval={0} tick={{ fontSize: 8 }} /><YAxis domain={[0, "auto"]} tick={{ fontSize: 9 }} /><Tooltip contentStyle={{ fontSize: 10 }} formatter={(value, name) => [Number(value).toFixed(3), METHODS[name]]} />{Object.keys(METHODS).map((method) => <Bar key={method} dataKey={method} name={method} fill={COLORS[method]} radius={[2, 2, 0, 0]} isAnimationActive={false} />)}<Legend formatter={(value) => SHORT_METHODS[value]} wrapperStyle={{ fontSize: 9 }} /></BarChart></ResponsiveContainer></Panel>
      <Panel title="Состояния агентов (тепловая карта)" className="heat-panel"><StateHeatmap states={data.states} agents={totalAgents} steps={data.series.length} /></Panel>
      <Panel title="События изоляции" subtitle={`Показано событий: ${data.events.length}`}><div className="table-wrap"><table><thead><tr><th>Шаг</th><th>Агент</th><th>Тип</th><th>Подтв.</th><th>Длит.</th></tr></thead><tbody>{data.events.length ? data.events.map((event, index) => <tr key={`${event.agent}-${event.step}-${index}`}><td>{event.step}</td><td>{event.agent}</td><td className={event.type === "false_positive" ? "danger-text" : ""}>{event.type === "sybil" ? "Sybil" : event.type === "byzantine" ? "Визант." : "Ложная"}</td><td>{event.confirmations}</td><td>{event.duration}</td></tr>) : <tr><td colSpan="5" className="muted-cell">События отсутствуют</td></tr>}</tbody></table></div></Panel>
    </div>
  </>;
}

function BoxPlotSvg({ summary }) {
  if (!summary) return null;
  const low = summary.min;
  const high = summary.max;
  const span = Math.max(high - low, 1e-12);
  const x = (value) => 35 + ((value - low) / span) * 530;
  return <div className="boxplot"><svg viewBox="0 0 600 105" role="img" aria-label="Диаграмма размаха"><line x1={x(summary.min)} x2={x(summary.max)} y1="51" y2="51" className="box-whisker" /><line x1={x(summary.min)} x2={x(summary.min)} y1="39" y2="63" className="box-whisker" /><line x1={x(summary.max)} x2={x(summary.max)} y1="39" y2="63" className="box-whisker" /><rect x={x(summary.q25)} y="31" width={Math.max(x(summary.q75) - x(summary.q25), 1)} height="40" className="box-iqr" /><line x1={x(summary.median)} x2={x(summary.median)} y1="31" y2="71" className="box-median" /><line x1={x(summary.q05)} x2={x(summary.q05)} y1="43" y2="59" className="box-quantile" /><line x1={x(summary.q95)} x2={x(summary.q95)} y1="43" y2="59" className="box-quantile" /><text x={x(summary.min)} y="91" textAnchor="middle">{summary.min.toFixed(3)}</text><text x={x(summary.median)} y="18" textAnchor="middle">median {summary.median.toFixed(3)}</text><text x={x(summary.max)} y="91" textAnchor="middle">{summary.max.toFixed(3)}</text></svg><div className="box-caption">Усы: min–max; засечки: P5/P95; прямоугольник: P25–P75.</div></div>;
}

function DistributionPanel({ distributions }) {
  const metrics = [...new Set(distributions.map((item) => item.metric))];
  const [metric, setMetric] = useState(metrics[0] || "rmse_to_truth");
  const [method, setMethod] = useState("proposed_robust");
  useEffect(() => { if (metrics.length && !metrics.includes(metric)) setMetric(metrics[0]); }, [metrics, metric]);
  const selected = distributions.find((item) => item.metric === metric && item.method === method);
  return <Panel title="Распределение результатов прогонов" subtitle="Гистограмма и непараметрическая сводка выбранной метрики" headerAside={<div className="chart-tools"><select className="compact-select" value={metric} onChange={(event) => setMetric(event.target.value)}>{metrics.map((value) => <option key={value} value={value}>{METRIC_LABELS[value] || value}</option>)}</select><select className="compact-select" value={method} onChange={(event) => setMethod(event.target.value)}>{Object.entries(SHORT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}>
    {selected ? <div className="distribution-grid"><ResponsiveContainer width="100%" height={250}><BarChart data={selected.histogram} margin={{ top: 8, right: 10, left: -8, bottom: 35 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" interval={Math.max(0, Math.floor(selected.histogram.length / 7))} angle={-25} textAnchor="end" tick={{ fontSize: 8 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => [value, "Число прогонов"]} /><Bar dataKey="count" fill={COLORS[method]} radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer><BoxPlotSvg summary={selected} /></div> : <div className="muted-cell">Нет данных</div>}
  </Panel>;
}

function BootstrapPanel({ rows }) {
  return <Panel title="Парные bootstrap-интервалы различий методов" subtitle="Положительная величина эффекта означает преимущество робастного метода"><div className="table-wrap large"><table><thead><tr><th>Метрика</th><th>Базовый метод</th><th>Эффект</th><th>95% bootstrap CI</th><th>P(эффект&gt;0)</th><th>Вывод</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.metric}-${row.baseline}-${index}`}><td>{METRIC_LABELS[row.metric] || row.metric}</td><td>{SHORT_METHODS[row.baseline]}</td><td>{row.benefit_mean.toFixed(4)}</td><td>[{row.benefit_ci_low.toFixed(4)}; {row.benefit_ci_high.toFixed(4)}]</td><td>{(row.probability_better * 100).toFixed(1)}%</td><td className={row.benefit_ci_low > 0 ? "success-text" : row.benefit_ci_high < 0 ? "danger-text" : ""}>{row.benefit_ci_low > 0 ? "Преимущество подтверждено" : row.benefit_ci_high < 0 ? "Базовый метод лучше" : "Интервал включает 0"}</td></tr>)}</tbody></table></div></Panel>;
}

function MonteCarlo({ data, onRun, running }) {
  const [bandMode, setBandMode] = useState("sigma");
  const rows = data?.summary || [];
  const trajectory = data?.trajectory_statistics || [];
  const chart = rows.map((row) => ({ ...row, label: SHORT_METHODS[row.method] }));
  const runCount = data?.trajectory_statistics_definition?.run_count ?? trajectory[0]?.run_count ?? 0;
  return <div className="tab-stack"><div className="tab-action"><div><h2>Серия Монте-Карло</h2><p>Средние траектории, σ- и квантильные области, bootstrap-сравнение и распределения метрик.</p></div><button className="secondary-button" onClick={onRun} disabled={running}><Icon name="play" />Выполнить серию</button></div>{data?.partial ? <div className="partial-banner">Расчет остановлен: получено {data.completed_runs} из {data.requested_runs} прогонов. Повторный запуск с теми же параметрами продолжит серию с контрольной точки.</div> : null}{rows.length ? <>
    <div className="kpi-grid three">{rows.map((row) => <Kpi key={row.method} label={METHODS[row.method]} value={`${(row.probability_correct_mean * 100).toFixed(1)}%`} note={`RMSE ${row.rmse_to_truth_mean.toFixed(3)} ± ${Number(row.rmse_to_truth_ci95 ?? 0).toFixed(3)}`} tone={row.method === "proposed_robust" ? "teal" : "blue"} />)}</div>
    <Panel title="Межпрогонная динамика коллективного решения" subtitle={`R=${runCount}; σ — выборочное СКО, квантильные области не требуют нормальности`} headerAside={<select className="compact-select" value={bandMode} onChange={(event) => setBandMode(event.target.value)}><option value="sigma">±1σ/±2σ</option><option value="quantile">P25–P75/P5–P95</option><option value="both">Все области</option></select>}><ResponsiveContainer width="100%" height={390}><ComposedChart data={trajectory} margin={{ top: 16, right: 26, left: -6, bottom: 12 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="step" tick={{ fontSize: 10 }} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ fontSize: 11 }} formatter={formatChartValue} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area dataKey="tolerance_band" name="Допустимое отклонение ±δ" stroke="none" fill="#dff4ea" fillOpacity={0.38} /><DecisionAreas hasBands mode={bandMode} /><ReferenceLine x={data.configuration.attack_start_step} stroke={COLORS.danger} strokeDasharray="4 4" label={{ value: "Начало атаки", fill: COLORS.danger, fontSize: 9 }} /><Line dataKey="truth" name="Желаемое действие" stroke="#7d8792" strokeDasharray="5 4" dot={false} /><Line dataKey="arithmetic_mean_mean" name="Арифметическое" stroke={COLORS.arithmetic_mean} strokeDasharray="5 3" dot={false} /><Line dataKey="trust_weighted_mean_mean" name="С учетом доверия" stroke={COLORS.trust_weighted_mean} dot={false} /><Line dataKey="proposed_robust_mean" name="Робастное среднее" stroke={COLORS.proposed_robust} dot={false} strokeWidth={2.4} /><Line dataKey="proposed_robust_median" name="Робастная медиана" stroke={COLORS.violet} strokeDasharray="3 3" dot={false} /></ComposedChart></ResponsiveContainer></Panel>
    <div className="mc-grid"><Panel title="Вероятность правильного решения"><ResponsiveContainer width="100%" height={320}><BarChart data={chart} margin={{ top: 12, right: 20, left: -8, bottom: 24 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis domain={[0, 1]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="probability_correct_mean" name="P(правильное решение)" radius={[3, 3, 0, 0]}>{rows.map((row) => <Cell key={row.method} fill={COLORS[row.method]} />)}</Bar></BarChart></ResponsiveContainer></Panel><Panel title="Статистические результаты"><div className="table-wrap large"><table><thead><tr><th>Метод</th><th>Pправ.</th><th>RMSE</th><th>MAE</th><th>Детекция</th><th>Доставка</th></tr></thead><tbody>{rows.map((row) => <tr key={row.method}><td>{SHORT_METHODS[row.method]}</td><td>{row.probability_correct_mean.toFixed(3)}</td><td>{row.rmse_to_truth_mean.toFixed(3)}</td><td>{row.mae_to_truth_mean.toFixed(3)}</td><td>{row.detection_rate_mean.toFixed(3)}</td><td>{row.delivery_ratio_mean.toFixed(3)}</td></tr>)}</tbody></table></div></Panel></div>
    <BootstrapPanel rows={data.bootstrap_comparisons || []} />
    <DistributionPanel distributions={data.distributions || []} />
  </> : <div className="empty">Запустите серию для расчета статистических областей и сравнений.</div>}</div>;
}

function Sensitivity({ data, mode, setMode, onRun, running }) {
  const [metric, setMetric] = useState("probability_correct");
  const oneRows = data?.mode === "one_factor" ? data.sensitivity || [] : [];
  const oneChart = useMemo(() => {
    const map = new Map();
    oneRows.forEach((row) => { const item = map.get(row.n_byzantine) || { n_byzantine: row.n_byzantine }; item[row.method] = row.probability_correct; map.set(row.n_byzantine, item); });
    return [...map.values()].sort((a, b) => a.n_byzantine - b.n_byzantine);
  }, [oneRows]);
  const effects = data?.mode === "factorial" ? (data.main_effects || []).filter((row) => row.metric === metric).map((row) => ({ ...row, label: FACTOR_LABELS[row.factor] || row.factor })) : [];
  const interactions = data?.mode === "factorial" ? (data.interaction_effects || []).filter((row) => row.metric === metric).slice(0, 10) : [];
  return <div className="tab-stack"><div className="tab-action sensitivity-action"><div><h2>Анализ чувствительности</h2><p>Однофакторное изменение f либо двухуровневый многофакторный план по шести параметрам.</p></div><div className="action-controls"><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="one_factor">Однофакторный анализ</option><option value="factorial">Многофакторный план</option></select><button className="secondary-button" onClick={() => onRun(mode)} disabled={running}><Icon name="play" />Выполнить</button></div></div>{data?.partial ? <div className="partial-banner">Сохранены частичные результаты: {data.completed_tasks} из {data.requested_tasks} заданий.</div> : null}{mode === "one_factor" ? (oneChart.length ? <Panel title="Устойчивость к доле скомпрометированных агентов" subtitle="Вероятность правильного решения для трех методов"><ResponsiveContainer width="100%" height={470}><LineChart data={oneChart} margin={{ top: 18, right: 32, left: 0, bottom: 18 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="n_byzantine" tick={{ fontSize: 10 }} label={{ value: "Число византийских агентов f", position: "insideBottom", offset: -8, fontSize: 10 }} /><YAxis domain={[0, 1]} tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 10 }} />{Object.keys(METHODS).map((method) => <Line key={method} dataKey={method} name={METHODS[method]} stroke={COLORS[method]} strokeWidth={method === "proposed_robust" ? 2.6 : 1.7} dot={{ r: 3 }} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></Panel> : <div className="empty">Запустите однофакторный анализ.</div>) : (effects.length ? <><Panel title="Главные эффекты факторов" subtitle="Разность среднего отклика на верхнем и нижнем уровнях; знак зависит от выбранной метрики" headerAside={<select className="compact-select" value={metric} onChange={(event) => setMetric(event.target.value)}><option value="probability_correct">P(правильное решение)</option><option value="rmse_to_truth">RMSE</option><option value="detection_rate">Полнота обнаружения</option><option value="delivery_ratio">Доля доставки</option></select>}><ResponsiveContainer width="100%" height={390}><BarChart data={effects} layout="vertical" margin={{ top: 10, right: 25, left: 150, bottom: 10 }}><CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => Number(value).toFixed(4)} /><ReferenceLine x={0} stroke="#87929d" /><Bar dataKey="effect_high_minus_low" name="Эффект верхний−нижний" fill={COLORS.proposed_robust} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></Panel><div className="mc-grid"><Panel title="Наиболее сильные взаимодействия факторов"><div className="table-wrap large"><table><thead><tr><th>Факторы</th><th>Эффект</th></tr></thead><tbody>{interactions.map((row, index) => <tr key={index}><td>{row.factors.map((factor) => FACTOR_LABELS[factor] || factor).join(" × ")}</td><td>{row.effect.toFixed(4)}</td></tr>)}</tbody></table></div></Panel><Panel title="Точки факторного плана"><div className="table-wrap large"><table><thead><tr><th>№</th><th>Метод</th><th>Pправ.</th><th>RMSE</th><th>Детекция</th></tr></thead><tbody>{(data.design_points || []).slice(0, 80).map((row, index) => <tr key={index}><td>{row.design_index + 1}</td><td>{SHORT_METHODS[row.method]}</td><td>{row.probability_correct.toFixed(3)}</td><td>{row.rmse_to_truth.toFixed(3)}</td><td>{row.detection_rate.toFixed(3)}</td></tr>)}</tbody></table></div></Panel></div></> : <div className="empty">Запустите многофакторный анализ. Полный план содержит до 64 точек.</div>)}</div>;
}

function downloadBlob(name, content, type) {
  const mimeType = type.includes("charset=") ? type : `${type};charset=utf-8`;
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function DataTab({ trace, monteCarlo, sensitivityByMode }) {
  const items = [
    ["Трассировка одного прогона", "Решения, репутации, состояния агентов, сетевые показатели и события изоляции.", "trace.json", trace],
    ["Серия Монте-Карло", "σ- и квантильные области, bootstrap-интервалы и распределения метрик.", "monte_carlo.json", monteCarlo],
    ["Однофакторная чувствительность", "Изменение показателей при варьировании числа нарушителей.", "sensitivity_one_factor.json", sensitivityByMode.one_factor],
    ["Многофакторная чувствительность", "Точки факторного плана, главные эффекты и взаимодействия.", "sensitivity_factorial.json", sensitivityByMode.factorial],
  ];
  return <div className="data-grid">{items.map(([title, text, filename, value]) => <section className="data-row" key={title}><div><h3>{title}</h3><p>{text}</p>{value?.log_file ? <small>Основной журнал: {value.log_file}</small> : null}{value?.trajectory_log_file ? <small>Пошаговая статистика: {value.trajectory_log_file}</small> : null}{value?.bootstrap_log_file ? <small>Bootstrap: {value.bootstrap_log_file}</small> : null}</div><button onClick={() => downloadBlob(filename, JSON.stringify(value, null, 2), "application/json;charset=utf-8")} disabled={!value}><Icon name="download" />Скачать JSON</button></section>)}</div>;
}

function Formula({ number, children }) {
  return <div className="formula"><span>{children}</span><b>({number})</b></div>;
}

const HELP_SECTIONS = [
  ["purpose", "Назначение и постановка задачи"], ["agents", "Агенты и модель нарушителя"], ["trust", "Модель доверия"], ["reputation", "Глобальная репутация"], ["isolation", "Изоляция и восстановление"], ["aggregation", "Робастное агрегирование"], ["network", "Сетевая модель"], ["sybil", "Sybil-атака"], ["statistics", "Межпрогонная статистика"], ["bootstrap", "Bootstrap-сравнение"], ["distributions", "Распределения"], ["sensitivity", "Анализ чувствительности"], ["parallel", "Параллельный расчет и кэш"], ["process", "Порядок эксперимента"], ["software", "Программный комплекс"], ["interpretation", "Интерпретация"], ["glossary", "Термины"], ["limits", "Ограничения"],
];

function TrustHelpArticle() {
  return <article className="help-article"><h2 className="help-article-title">Справка по модельному эксперименту ИМАС</h2>
    <section id="purpose"><h2>Назначение и постановка задачи</h2><p>Комплекс моделирует коллективную выработку скалярного решения в интеллектуальной мультиагентной системе при наличии корректных, византийских и ложных Sybil-идентичностей. Цель эксперимента состоит в оценке точности, воспроизводимости и киберустойчивости трех методов агрегирования при изменении параметров доверия, изоляции, атаки и сети.</p><div className="process-strip"><span>Предложения агентов</span><i>→</i><span>Сетевая доставка</span><i>→</i><span>Доверие и репутация</span><i>→</i><span>Робастное решение</span><i>→</i><span>Изоляция</span></div></section>
    <section id="agents"><h2>Агенты и модель нарушителя</h2><p>Корректный агент формирует предложение как сумму желаемого действия и нормального шума. Византийские агенты создают постоянное, малозаметное, периодическое или согласованное смещение. Sybil-идентичности являются дополнительными виртуальными агентами, управляемыми нарушителем и передающими согласованные значения.</p><Formula number="1">x<sub>i</sub>(t)=x<sup>*</sup>(t)+ε<sub>i</sub>(t), ε<sub>i</sub>∼N(0,σ²).</Formula><Formula number="2">x<sub>i</sub><sup>adv</sup>(t)=x<sup>*</sup>(t)+d·b<sub>s</sub>+η<sub>i</sub>(t).</Formula></section>
    <section id="trust"><h2>Дисконтированная Beta-модель доверия</h2><p>Для каждой пары «наблюдатель–оцениваемый агент» накапливаются положительные и отрицательные свидетельства. Отсутствующее из-за сетевого ограничения наблюдение обозначается NaN и не изменяет апостериорные параметры.</p><Formula number="3">α<sub>ij</sub>(t)=α₀+Σ<sub>k=0</sub><sup>W−1</sup>φ<sup>k</sup>e<sub>ij</sub>(t−k).</Formula><Formula number="4">β<sub>ij</sub>(t)=β₀+Σ<sub>k=0</sub><sup>W−1</sup>φ<sup>k</sup>[1−e<sub>ij</sub>(t−k)].</Formula><Formula number="5">w<sub>ij</sub>(t)=α<sub>ij</sub>(t)/(α<sub>ij</sub>(t)+β<sub>ij</sub>(t)).</Formula></section>
    <section id="reputation"><h2>Глобальная репутация</h2><p>Локальная оценка формируется медианой наблюдений внутри связной компоненты. Сетевая составляющая рассчитывается регуляризованным EigenTrust. Итоговая репутация является их выпуклой комбинацией.</p><Formula number="6">r=γC<sup>T</sup>r+(1−γ)v.</Formula><Formula number="7">w̃<sub>i</sub>=0.7·median<sub>j</sub>w<sub>ji</sub>+0.3·r<sub>i</sub>.</Formula></section>
    <section id="isolation"><h2>Изоляция и восстановление</h2><p>Агент изолируется после k последовательных подтверждений репутации ниже порога τiso. После периода охлаждения он возвращается в активное множество. Для показателей обнаружения учитывается факт хотя бы одной изоляции, а не только состояние на последнем шаге.</p><Formula number="8">I<sub>i</sub>(t)=1, если w̃<sub>i</sub>(t)&lt;τ<sub>iso</sub> на k последовательных шагах.</Formula></section>
    <section id="aggregation"><h2>Робастное агрегирование</h2><p>Реализованы арифметическое, доверительно-взвешенное и предлагаемый робастный методы. Робастный метод использует медианный центр, ограничение выбросов, симметричное усечение и проекцию на безопасный интервал.</p><Formula number="9">c(t)=median{'{'}x<sub>i</sub>(t){'}'}.</Formula><Formula number="10">x′<sub>i</sub>=clip(x<sub>i</sub>,c−R,c+R).</Formula><Formula number="11">x<sub>rob</sub>=Π<sub>S</sub>[Σ<sub>i∈T</sub>w̃<sub>i</sub>x′<sub>i</sub>/Σ<sub>i∈T</sub>w̃<sub>i</sub>].</Formula></section>
    <section id="network"><h2>Сетевая модель</h2><p>Поддерживаются полносвязная, кольцевая, случайная и small-world-топологии. В каждом шаге определяются связные компоненты. Глобальное решение формирует крупнейшая компонента; сообщения могут теряться, задерживаться, оставаться в очереди или отбрасываться из-за ограничения пропускной способности. Разделение сети временно удаляет межсегментные ребра.</p><Formula number="12">A(t)=A₀⊙M<sub>active</sub>(t)⊙M<sub>partition</sub>(t).</Formula><Formula number="13">P(delivery)=1−p<sub>loss</sub>, d∈[d<sub>min</sub>,d<sub>max</sub>].</Formula><p>При отсутствии свежего значения допускается использование последнего доставленного сообщения не старше заданного числа шагов.</p></section>
    <section id="sybil"><h2>Sybil-атака</h2><p>Sybil-идентичности добавляются сверх N легитимных агентов, образуют плотный кластер и совместно поддерживают ложные оценки. Базовое условие N&gt;2f проверяется для легитимных идентичностей; после появления Sybil-узлов эффективное честное большинство может быть нарушено, что является предметом исследования.</p><Formula number="14">N<sub>eff</sub>=N+N<sub>sybil</sub>, f<sub>eff</sub>=f+N<sub>sybil</sub>.</Formula></section>
    <section id="statistics"><h2>Межпрогонная статистика</h2><p>Для каждого шага сохраняются траектории всех независимых прогонов. Помимо среднего и выборочного СКО рассчитываются медиана и квантили. Квантильные области предпочтительны при асимметрии и мультимодальности.</p><Formula number="15">s(t)=√[(R−1)<sup>−1</sup>Σ<sub>r</sub>(x<sup>(r)</sup>(t)−x̄(t))²].</Formula><Formula number="16">B<sub>σ,k</sub>(t)=[x̄(t)−ks(t),x̄(t)+ks(t)], k∈{'{'}1,2{'}'}.</Formula><Formula number="17">B<sub>90</sub>(t)=[Q<sub>0.05</sub>(t),Q<sub>0.95</sub>(t)], B<sub>50</sub>(t)=[Q<sub>0.25</sub>(t),Q<sub>0.75</sub>(t)].</Formula></section>
    <section id="bootstrap"><h2>Парный bootstrap различий методов</h2><p>Сравнение выполняется по одним и тем же случайным прогонам, поэтому сохраняется парность наблюдений. На каждой bootstrap-итерации с возвращением выбираются индексы прогонов и вычисляется средняя разность. Для ошибок знак преобразуется так, чтобы положительный эффект всегда означал преимущество робастного метода.</p><Formula number="18">Δ<sub>b</sub>=R<sup>−1</sup>Σ<sub>r∈S<sub>b</sub></sub>[L<sub>base</sub><sup>(r)</sup>−L<sub>rob</sub><sup>(r)</sup>].</Formula><p>95%-й интервал задается эмпирическими квантилями 2.5% и 97.5% bootstrap-распределения.</p></section>
    <section id="distributions"><h2>Распределения результатов</h2><p>Для RMSE, MAE, вероятности правильного решения, полноты и времени обнаружения формируются гистограммы и сводки min, P5, P25, медиана, P75, P95, max. Это позволяет выявить выбросы, асимметрию и несколько режимов функционирования, которые скрываются за средним значением.</p></section>
    <section id="sensitivity"><h2>Анализ чувствительности</h2><p>Однофакторный режим изменяет число византийских агентов. Многофакторный режим реализует двухуровневый план по шести факторам: f, τiso, окно доверия, коэффициент забывания, интенсивность атаки и шум корректных агентов.</p><Formula number="19">E<sub>j</sub>=E[y|z<sub>j</sub>=+1]−E[y|z<sub>j</sub>=−1].</Formula><Formula number="20">E<sub>jk</sub>=E[y|z<sub>j</sub>z<sub>k</sub>=+1]−E[y|z<sub>j</sub>z<sub>k</sub>=−1].</Formula></section>
    <section id="parallel"><h2>Параллельное выполнение, прогресс и кэш</h2><p>Независимые прогоны распределяются между процессами. Сервер сообщает число завершенных задач и оценку оставшегося времени. После каждого блока сохраняется контрольная точка. При остановке частичные результаты остаются доступными, а повторный запуск той же конфигурации продолжает расчет. Полностью завершенный результат сохраняется в кэше по SHA-256 хешу канонической конфигурации.</p></section>
    <section id="process"><h2>Порядок проведения эксперимента</h2><ol><li>Проверка параметров и построение топологии.</li><li>Выбор византийских агентов и создание Sybil-идентичностей.</li><li>Формирование предложений и сетевая доставка.</li><li>Расчет доверия и репутации по доступным свидетельствам.</li><li>Агрегирование решения и расчет ошибок.</li><li>Обновление свидетельств, изоляция и восстановление.</li><li>Повторение T шагов и R независимых прогонов.</li><li>Расчет σ-, квантильных и bootstrap-интервалов, распределений и чувствительности.</li></ol></section>
    <section id="software"><h2>Описание программного комплекса</h2><table className="help-table"><thead><tr><th>Компонент</th><th>Назначение</th></tr></thead><tbody><tr><td><code>experiment.py</code></td><td>Математическое ядро, сеть, Sybil-модель, параллельные серии, статистика и чувствительность.</td></tr><tr><td><code>gui_bridge.py</code></td><td>JSON-интерфейс и передача сообщений о прогрессе.</td></tr><tr><td><code>gui/server.mjs</code></td><td>Менеджер заданий, остановка, контрольные точки, кэш и журналирование.</td></tr><tr><td><code>gui/src/main.jsx</code></td><td>Интерфейс, графики, статистические панели и справка.</td></tr><tr><td><code>test_experiment.py</code></td><td>Проверки численных процедур, сети, статистики и возобновления.</td></tr></tbody></table></section>
    <section id="interpretation"><h2>Интерпретация результатов</h2><ul><li>Узкие σ- и квантильные области означают воспроизводимость решения.</li><li>Различие между средним и медианой указывает на асимметрию распределения.</li><li>Bootstrap-интервал, полностью расположенный выше нуля, подтверждает преимущество робастного метода по выбранной метрике.</li><li>Снижение крупнейшей компоненты и доли доставки показывает влияние разделения, потерь и пропускной способности.</li><li>Сильный главный эффект определяет параметр, наиболее существенно изменяющий отклик в исследованном диапазоне.</li></ul></section>
    <section id="glossary"><h2>Термины и обозначения</h2><dl className="glossary"><dt>ИМАС</dt><dd>Интеллектуальная мультиагентная система.</dd><dt>Византийский агент</dt><dd>Участник, способный передавать произвольные или согласованно ложные данные.</dd><dt>Sybil-атака</dt><dd>Создание одним нарушителем множества ложных идентичностей.</dd><dt>Квантильная область</dt><dd>Интервал между заданными квантилями эмпирического распределения.</dd><dt>Парный bootstrap</dt><dd>Повторная выборка общих индексов прогонов для сравниваемых методов.</dd><dt>Контрольная точка</dt><dd>Сохраненное промежуточное состояние серии, позволяющее возобновить расчет.</dd><dt>Факторный эффект</dt><dd>Изменение среднего отклика между верхним и нижним уровнями фактора.</dd><dt>Компонента связности</dt><dd>Максимальное множество узлов, между которыми существуют сетевые пути.</dd></dl></section>
    <section id="limits"><h2>Ограничения применимости</h2><p>Сетевая модель является дискретной и агрегированной: не моделируются конкретные протоколы маршрутизации, очереди пакетов каждого канала и криптографические затраты. Скалярное решение не заменяет предметную многомерную модель объекта. Bootstrap и факторные эффекты характеризуют только заданные диапазоны и сценарии. Практические выводы требуют калибровки на цифровом двойнике или стенде конкретного объекта.</p></section>
  </article>;
}

function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [scenario, setScenario] = useState("collusion");
  const [attackLevel, setAttackLevel] = useState("high");
  const [activeTab, setActiveTab] = useState("trace");
  const [trace, setTrace] = useState(null);
  const [monteCarlo, setMonteCarlo] = useState(null);
  const [sensitivityByMode, setSensitivityByMode] = useState({ one_factor: null, factorial: null });
  const [sensitivityMode, setSensitivityMode] = useState("one_factor");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [progress, setProgress] = useState(null);
  const [cacheHit, setCacheHit] = useState(false);
  const jobRef = useRef(null);
  const runningRef = useRef(false);
  const researchActionsRef = useRef(null);
  const [researchRuntime,setResearchRuntime] = useState(null);

  const request = async (action, options = {}) => {
    if (runningRef.current) return;
    const mode = options.sensitivityMode || sensitivityMode;
    const requestSignature = JSON.stringify({ scenario, config });
    runningRef.current = true;
    setRunning(true);
    setError("");
    setCacheHit(false);
    setProgress({ stage: "queued", completed: 0, total: 1, percent: 0, message: "Подготовка задания" });
    const started = performance.now();
    try {
      const maxF = Math.floor((config.n_agents - 1) / 2);
      const candidates = [0, Math.round(maxF * 0.2), Math.round(maxF * 0.4), Math.round(maxF * 0.6), Math.round(maxF * 0.8), maxF];
      const payload = { action, scenario, config, sensitivity_mode: mode, f_values: [...new Set(candidates)] };
      const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || "Не удалось создать задание");
      jobRef.current = created.id;
      let terminal = null;
      while (!terminal) {
        const statusResponse = await fetch(`/api/jobs/${created.id}`);
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || "Не удалось получить состояние задания");
        setProgress(status.progress || null);
        setCacheHit(Boolean(status.cache_hit));
        if (["completed", "stopped", "failed"].includes(status.state)) terminal = status;
        else await sleep(350);
      }
      if (terminal.state === "failed") throw new Error(terminal.error || "Ошибка моделирования");
      const body = terminal.result;
      if (!body) throw new Error("Вычислительный процесс не вернул результат");
      const wrapped = { ...body, client_signature: requestSignature };
      if (action === "trace") setTrace(wrapped);
      if (action === "monte_carlo") setMonteCarlo(wrapped);
      if (action === "sensitivity") setSensitivityByMode((current) => ({ ...current, [mode]: wrapped }));
      setLastRun({ action, mode, seconds: (performance.now() - started) / 1000, at: new Date(), log: body.log_file, partial: Boolean(body.partial), cacheHit: terminal.cache_hit });
      if (terminal.state === "stopped" || body.partial) setError("Расчет остановлен. Частичные результаты и контрольная точка сохранены.");
    } catch (reason) {
      setError(reason.message || String(reason));
    } finally {
      jobRef.current = null;
      runningRef.current = false;
      setRunning(false);
    }
  };

  useEffect(() => { request("trace"); }, []);

  const stop = async () => {
    if (!jobRef.current) return;
    try { await fetch(`/api/jobs/${jobRef.current}`, { method: "DELETE" }); } catch { /* status polling will surface an error */ }
  };
  const reset = () => {
    stop();
    setConfig(DEFAULT_CONFIG);
    setScenario("collusion");
    setAttackLevel("high");
    setTrace(null);
    setMonteCarlo(null);
    setSensitivityByMode({ one_factor: null, factorial: null });
    setLastRun(null);
    setProgress(null);
    setError("");
    setActiveTab("trace");
  };
  const newSeed = () => setConfig((current) => ({ ...current, seed: Math.floor((Date.now() + Math.random() * 100000) % 2147483647) }));
  const runForTab = () => request(activeTab === "mc" ? "monte_carlo" : activeTab === "sensitivity" ? "sensitivity" : "trace", { sensitivityMode });
  const experimentSignature = JSON.stringify({ scenario, config });
  const currentTrace = trace?.client_signature === experimentSignature ? trace : null;
  const currentMonteCarlo = monteCarlo?.client_signature === experimentSignature ? monteCarlo : null;
  const currentSensitivityByMode = {
    one_factor: sensitivityByMode.one_factor?.client_signature === experimentSignature ? sensitivityByMode.one_factor : null,
    factorial: sensitivityByMode.factorial?.client_signature === experimentSignature ? sensitivityByMode.factorial : null,
  };
  const currentSensitivity = currentSensitivityByMode[sensitivityMode];
  const exportVisibleCharts = () => {
    const charts = [...document.querySelectorAll(".recharts-responsive-container svg, .boxplot svg, .r27-playback-svg")];
    charts.forEach((chart, index) => downloadBlob(`imas-${activeTab}-figure-${String(index + 1).padStart(2, "0")}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(chart)}`, "image/svg+xml;charset=utf-8"));
  };
  const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  const isResearch=activeTab.startsWith("study-");
  const researchReady=isResearch&&researchRuntime?.studyId===activeTab.slice(6);
  const visibleRunning=isResearch?(researchReady&&Boolean(researchRuntime.running)):running;
  const visibleSeed=isResearch?(researchReady?researchRuntime.seed:"—"):config.seed;
  const lastTimestamp=isResearch?(researchReady&&researchRuntime.lastCompletedAt?new Date(researchRuntime.lastCompletedAt).toLocaleString("ru-RU"):"—"):(lastRun?.at ? lastRun.at.toLocaleString("ru-RU") : "—");
  const experimentNavigation = (
<nav className="r27-experiment-navigation" aria-label="Выбор эксперимента">
<label htmlFor="imas-experiment-select">Эксперимент
<select id="imas-experiment-select" aria-label="Выбор эксперимента" value={activeTab.startsWith("study-")?activeTab:"trace"} onChange={e=>setActiveTab(e.target.value)}>
<option value="trace">Расчет доверия</option>
<option value="study-uncertainty">Автоматические решения</option>
<option value="study-probgraph">Коллективное решение</option>
<option value="study-petri">Опасные состояния</option>
<option value="study-cascade">Каскадные последствия</option>
<option value="study-misinformation">Нарушение коллективного решения</option>
</select></label>
{["trace","mc","sensitivity","data"].includes(activeTab)?<div className="r27-baseline-subtabs">{[["trace","Один прогон"],["mc","Монте-Карло"],["sensitivity","Чувствительность"],["data","Данные"]].map(([id,name])=><button type="button" key={id} className={activeTab===id?"active":""} onClick={()=>setActiveTab(id)}>{name}</button>)}</div>:null}
<button type="button" className={"r27-nav-right"+(activeTab==="help2027"?" active":"")} onClick={()=>setActiveTab("help2027")}>Справка</button>

<button type="button" className="r27-export-control" title="Экспорт графиков в SVG" onClick={exportVisibleCharts} disabled={["data","help2027"].includes(activeTab)}><Icon name="export"/>SVG</button>
</nav>
  );

  return <div className="app-shell"><header className="topbar"><div className="brand"><h1>IMAS-lab · Лабораторный стенд ИМАС</h1></div><div className="top-meta"><span>Статус:</span><strong className={visibleRunning?"busy-text":"ready-text"}>{visibleRunning?"Выполняется":"Готов к запуску"}</strong><span className="meta-separator"/><span>Последний прогон:</span><strong>{lastTimestamp}</strong><span className="meta-separator"/><span>Сид:</span><strong>{visibleSeed}</strong>{!isResearch&&lastRun?.cacheHit?<span className="cache-badge">кэш</span>:null}</div><div className="toolbar">
{["trace","mc","sensitivity","data"].includes(activeTab)?<>
<button onClick={newSeed} disabled={running}><Icon name="seed"/>Новый сид</button>
<button className="primary-small" onClick={runForTab} disabled={running||activeTab==="data"}><Icon name="play"/>Запустить</button>
<button onClick={stop} disabled={!running}><Icon name="stop"/>Остановить</button>
<button onClick={reset} disabled={running}><Icon name="reset"/>Сбросить</button>
</>:isResearch?<>
<button onClick={()=>researchActionsRef.current?.newSeed()} disabled={!researchReady||visibleRunning}><Icon name="seed"/>Новый сид</button>
<button className="primary-small" onClick={()=>researchActionsRef.current?.start()} disabled={!researchReady||visibleRunning}><Icon name="play"/>Запустить</button>
<button onClick={()=>researchActionsRef.current?.stop()} disabled={!researchReady||!visibleRunning}><Icon name="stop"/>Остановить</button>
<button onClick={()=>researchActionsRef.current?.reset()} disabled={!researchReady||visibleRunning}><Icon name="reset"/>Сбросить</button>
</>:null}
<button className="icon-button" title="Полноэкранный режим" onClick={toggleFullscreen}><Icon name="fullscreen"/></button>
<button className="icon-button" title="Справка" onClick={()=>setActiveTab("help2027")}><Icon name="help"/></button>
</div></header>
    <div className={"workspace"+(activeTab==="help2027"?" research-2027-workspace":"")}>
      {isResearch
        ? <ResearchStudy key={activeTab} studyId={activeTab.slice(6)} navigation={experimentNavigation} ref={researchActionsRef} onRuntimeChange={setResearchRuntime}/>
        : activeTab==="help2027"
          ? <main className="content r27-research-content">{experimentNavigation}<ResearchHelp baselineArticle={<TrustHelpArticle/>} baselineSections={HELP_SECTIONS}/></main>
          : <ExperimentLayout
              sidebar={<Sidebar config={config} setConfig={setConfig} scenario={scenario} setScenario={setScenario} attackLevel={attackLevel} setAttackLevel={setAttackLevel} onRun={() => request("trace")} running={running}/>}
              navigation={experimentNavigation}
              studyId="trust"
              authors="Авторы · ктн Ушаков И.А. · Трофимова Н.А."
              title="Математическая модель интеллектуальной мультиагентной системы поддержки принятия решений для защищенных информационных систем специального назначения"
              description="Моделирование динамики доверия, репутации и устойчивости коллективного решения при кибервоздействиях."
              progress={<ProgressStrip progress={progress} running={running} cacheHit={cacheHit}/>}
              error={error?<div className="error-banner">{error}</div>:null}
            >
              {activeTab==="trace"?<SingleRun data={currentTrace} config={config} trajectoryStatistics={currentMonteCarlo?.trajectory_statistics} onRunBands={() => request("monte_carlo")} running={running}/>:null}
              {activeTab==="mc"?<MonteCarlo data={currentMonteCarlo} onRun={() => request("monte_carlo")} running={running}/>:null}
              {activeTab==="sensitivity"?<Sensitivity data={currentSensitivity} mode={sensitivityMode} setMode={setSensitivityMode} onRun={mode=>request("sensitivity",{sensitivityMode:mode})} running={running}/>:null}
              {activeTab==="data"?<DataTab trace={currentTrace} monteCarlo={currentMonteCarlo} sensitivityByMode={currentSensitivityByMode}/>:null}
            </ExperimentLayout>
    </div>
    {(isResearch||activeTab==="help2027")?<footer className="statusbar"><span>Шаги: {isResearch&&researchReady?(researchRuntime?.steps??"—"):"—"}</span><span>Время: {isResearch&&researchReady&&researchRuntime?.elapsedMs!=null?formatSeconds(researchRuntime.elapsedMs/1000):"—"}</span><span>{isResearch?(visibleRunning?"Вычисляется":researchRuntime?.hasResult?"Завершено":"—"):"Справка"}</span><span>Сид: {isResearch?visibleSeed:"—"}</span><span className="status-log">{isResearch?"Синтетическая модель — результаты требуют независимой валидации":"Единая справка по шести экспериментам"}</span></footer>:<footer className="statusbar"><span>Шаг: {currentTrace?.series?.at(-1)?.step ?? 0} / {config.n_steps}</span><span>Время: {lastRun ? formatSeconds(lastRun.seconds) : "—"}</span><span>{progress ? `${progress.completed ?? 0} / ${progress.total ?? 0}` : "—"}</span><span>Сид: {config.seed}</span><span className="status-log">{lastRun?.log ? `Лог: ${lastRun.log}` : ""}</span></footer>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
