# Аудит и единая структура тестов IMAS-lab

**Исходная ревизия до переноса:** `192517fefec1eeb4abb0db0bb5127a1c34ec3d27`.
**Рабочая ветка:** `IMAS_Lab_test`. Дата актуализации — 17.11.2026.
**Изменённые производственные алгоритмы:** отсутствуют; перенос тестов организационный.

## Результаты инвентаризации

| Объект | Исходное местоположение | Новое местоположение | Решение |
|---|---|---|---|
| 40 JavaScript-модулей Node `node:test` | `gui/src/*.test.mjs` | `tests/gui/*.test.mjs` | сохранить все |
| 11 модулей Python `unittest` | `test_*.py` (корень) | `tests/python/test_*.py` | сохранить все |
| Браузерная сквозная проверка Chromium | `gui/verify.mjs` | `tests/gui/verify.mjs` | сохранить |
| Мост независимого Python→JS оракула | `gui/src/up34Bridge.mjs` | `tests/gui/up34Bridge.mjs` | сохранить как тестовую вспомогательную программу |
| Повторный полный `npm test` после сборки | `.github/workflows/verify-2027.yml` | заменён целевой проверкой production-артефактов | устранить избыточный запуск |

## Аудит назначения и необходимости

Каждый файл отнесён к проверяемому контракту. Сходное название в нескольких
наборах не является основанием для удаления, если проверяются различные
входные данные, свойства, ошибки или уровни модели.

1. **Исходные E1 и четыре метода доверия:** `trustEngine`, `trustMethods`,
   `trustRemediationRegression`, `trustBrowserClient`, `trustHelpParity`.
   Контроль численных формул, границ, независимости методов, транспорта,
   отказов, защиты исходных результатов и соответствия справки реализации.
2. **E1-А и сетевой ресурс:** `adaptiveDecisionEngine`, `adaptiveScenario`,
   `adaptiveDecisionChannel`, `adaptiveRoutedDecisionChannel`,
   `adaptiveBandwidthScheduler`, `adaptiveFairBandwidth`,
   `adaptiveLocalConsensus`, `adaptiveLocalConsensusIntegration`,
   `adaptiveLocalTransport`, `adaptiveLocalAutonomy`,
   `adaptiveRiskController`, `adaptiveCampaign`, `adaptiveRiskCampaign`,
   `adaptiveBrowserClient`. Проверяются причинность, учёт сообщений и
   слотов, сходимость только в заявленных режимах, независимость локального
   и центрального контуров, воспроизводимость, доверие, эффекты атак.
3. **E2–E6 и общие численные методы:** `research2027`,
   `researchBoundaryConditions`, `researchFullArchives`,
   `researchRawProvenance`, `researchStatisticalAudit`,
   `researchCacheIntegrity`, `researchCheckpoint`,
   `researchBrowserClient`, `statistics2027`, `factorialAudit`,
   `monteCarloPlanning`, `petriOracle`, `metricPassport`,
   `metricFormatting`, `attackProfiles`, `phaseScheduling`,
   `lyapunovStudy`, `lyapunovCache`, `primitiveParity`.
   Содержат независимые свойства соответствующих экспериментов,
   статистики, теории графов, сетей Петри, архивов, восстановления и UI.
4. **Инфраструктура:** `cloudflareHosting` проверяет фактическое содержимое
   Vite-сборки и Cloudflare SPA; браузерный `verify.mjs` проверяет Web
   Workers, интерфейс, экспорт и повторный запуск в Chromium.
5. **Python-оракулы:** `test_experiment`, `test_encoding`,
   `test_external_calibration`, `test_legacy_divergences`,
   `test_primitive_parity`, `test_repository_hygiene`,
   `test_scientific_release_gate`, `test_up34_deterministic`,
   `test_up34_graph_and_marking`, `test_up34_network_trace`,
   `test_up34_research_raw`. Ключевое различие:
   `test_up34_*` — независимое повторное вычисление на одинаковых
   экзогенных событиях; `test_legacy_divergences` — явная проверка
   **неэквивалентности** исторического Python-ядра. Их объединение
   привело бы к потере различных проверяемых свойств.

**Удалённых тестовых модулей: 0.** Не обнаружен модуль с доказанно
устаревшим контрактом, пустым тестом или полностью эквивалентным покрытием.
Удалять такой файл без выполнения и независимого анализа поведения
недопустимо. Устранено одно избыточное повторное исполнение всего JS-набора
в workflow; тест Cloudflare после сборки сохранён и усилен явным требованием
наличия `dist/index.html`.

## Порядок выполнения

Из корня репозитория:

```bash
cd gui
npm ci
npm test
npm run build
npm run test:hosting:built
npm run preview
```

Отдельно при работающем `npm run preview`:

```bash
cd gui
npm run verify
```

Из корня репозитория для независимых Python-референсов:

```bash
pip install -r requirements.txt
python -m unittest discover -s tests/python -p 'test_*.py' -v
```

В GitHub Actions весь набор запускается из `IMAS_Lab_test`. Описанные
регрессии подтверждают программную согласованность, но **не** завершают
научную приёмку UP-36, внешнюю калибровку или доказательство византийского
консенсуса.

## Дополнение: 17.11.2026 — локальный контур действий

В `tests/gui/adaptiveLocalActionFeedback.test.mjs` добавлено 6 независимых
проверок нового необязательного режима: причинность, ограничение изменения,
политики отказа, сброс после инактивации, сохранность центрального E1 и
безусловная функция потерь на полном множестве честных агент-тактов.
Новый тест **не дублирует** `adaptiveLocalAutonomy.test.mjs`, который
проверяет направленное доверие и двухпороговую локальную фильтрацию.
Браузерная сквозная проверка обновлена для нового режима и метрик.
