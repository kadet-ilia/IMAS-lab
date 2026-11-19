# Журнал выполнения модернизации раздела «Адаптивные решения» (18–19.11.2026)

**Репозиторий:** kadet-ilia/IMAS-lab, ветка IMAS_Lab_test. **Основание:** adaptive-modernization-roadmap-2026-11-18.md. **Статус:** завершены М5-А, М5-Б, разработана отдельная `regime_aware_v2`, проведены новая поисковая (48 ячеек) и независимая подтверждающая (12 ячеек) серии, расширены М6 и М7. **Преимущество v1 и v2 относительно комбинированного E1 не подтвердилось**. Оба остаются экспериментальными и выключенными по умолчанию.

## Выполненные задачи по этапам плана

| Этап | Состояние | Доказательства и ограничения |
|---|---|---|
| М0 — фиксация исторического контроля | Выполнен для E1-А/f-k-L | Пять исторических ID сохранены, E1 baseline проверяется попарно, версии и SHA-256 источников входят в архив |
| М1 — уточнение эффективности | Реализовано | Основной контроль proposed_robust, вторичный trimmed_unweighted, условный RMSE и безусловная потеря со штрафом отказа |
| М2 — диагностика режима | Исследовательский прототип | EWMA + CUSUM, память, порог и гистерезис; не идентифицирует тип реальной атаки |
| М3 — политика выбора оценивателей | Реализованы прототипы v1 и v2 | V1: прогнозная медиана, гистерезис. V2: ограниченный Хьюбер-регрет, штраф неопределённости и переключений, явная доля базового E1. Оба не используют модельный эталон при выборе |
| М4 — пригодность свидетельств | Частично | Учитываются доступность, N_eff, модельные lag и корреляция; нет измеренной независимости источников, калибровки или защиты от сговора |
| М5 — факторные исследования | Выполнены серии А, Б и новая v2 | f×k×L: 80×30×4 и 16×100×4; периодичность: 80×20×3 и 16×80×3; новая v2: 48×12×5 и независимая 12×60×5. Получен отрицательный вывод о практически значимом преимуществе обеих политик |
| М6 — интерфейс | Дополнен новым исследовательским режимом и архивом | Диагностика v1/v2, значения регрета, стоимости переключений, доли E1, просмотр архивов М5-А/Б и новой v2, все полные прогоны, экспорт и фазовая аналитика; масштабная независимая UX-проверка остаётся задачей |
| М7 — верификация | Пилот вычислительной стоимости выполнен; аппаратная валидация впереди | Node/Python, Vite, браузерный smoke, арифметические проверки и 128 измеренных полных прогонов в двух режимах моделирования. Нет проверенной изолированной стоимости alpha, внешней репликации, реального времени и полевых испытаний |
| М8 — научное описание | Выполнено для текущего этапа | Математический паспорт, preregistration, отрицательные результаты обеих серий, журнал ограничений |

## Ключевые исходные файлы

- gui/src/adaptiveRegimeDetector.js
- gui/src/adaptiveEvidenceQuality.js
- gui/src/adaptivePolicySelector.js
- gui/src/adaptivePolicySelectorV2.js
- gui/src/adaptiveV2CampaignProtocol.js
- gui/src/adaptiveV2Results.js
- gui/src/AdaptiveV2ResultsPanel.jsx
- gui/src/adaptiveDecisionEngine.js
- gui/src/adaptiveExperiment.js
- gui/src/AdaptiveDecisionPanel.jsx
- gui/src/AdaptiveFklResultsPanel.jsx
- gui/src/adaptiveFklProtocol.js
- gui/src/adaptiveFklResults.js
- gui/src/adaptivePeriodicCampaignProtocol.js
- gui/src/adaptivePeriodicResults.js
- gui/src/AdaptivePeriodicResultsPanel.jsx
- gui/src/adaptiveExposureDiagnostics.js
- gui/src/adaptiveStudyDiagnostics.js
- gui/src/AdaptiveStudyAnalyticsPanel.jsx
- gui/src/adaptiveCostProtocol.js
- gui/scripts/adaptiveFklCampaign.mjs
- gui/scripts/adaptiveV2Campaign.mjs
- gui/scripts/auditV2Campaign.py
- gui/scripts/adaptivePeriodicCampaign.mjs
- gui/scripts/auditPeriodicCampaign.py
- gui/scripts/adaptiveCostBenchmark.mjs
- gui/scripts/auditCostBenchmark.py
- gui/scripts/auditFklResults.py
- tests/gui/adaptiveRegimePolicy.test.mjs
- tests/gui/adaptiveRegimeV2.test.mjs
- tests/gui/adaptiveV2Campaign.test.mjs
- tests/gui/adaptiveV2Results.test.mjs
- tests/gui/adaptiveFklCampaign.test.mjs
- tests/gui/adaptiveFklResults.test.mjs
- tests/gui/adaptivePeriodicCampaign.test.mjs
- tests/gui/adaptivePeriodicResults.test.mjs
- tests/gui/adaptiveExposureDiagnostics.test.mjs
- tests/gui/adaptiveStudyDiagnostics.test.mjs
- tests/gui/adaptiveCostProtocol.test.mjs
- tests/python/test_adaptive_fkl_audit.py
- .github/workflows/adaptive-e1a-fkl-factorial.yml
- .github/workflows/adaptive-e1a-v2-factorial.yml
- .github/workflows/adaptive-e1a-periodic-correlation.yml
- .github/workflows/adaptive-e1a-cost-pilot.yml

## Научные результаты

- [Поисковая факторная серия, GitHub Actions 44350372581](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44350372581): 80 ячеек, 2400 парных повторений, 9600 вычислений. ΔRMSE относительно комбинированного E1 = +0,005391 (adaptive), +0,004410 (risk_aware), +0,000247 (regime_aware discrete), +0,003024 (regime_aware blend).
- [Предварительно зафиксированная проверочная серия, GitHub Actions 44352963174](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44352963174): 16 ячеек, 1600 парных повторений, 6400 вычислений. ΔRMSE = +0,011404, +0,007100, +0,000291, +0,005666 соответственно.
- Общий fingerprint расчётного кода обеих серий: fdb50971b88dde03296834fa2829dab8a8a8d8fc560703e9a8fecc4c4db41402.
- Итоговый исходный контроль E1 в подтверждающей серии выбирался в конце 1600/1600 прогонов; 1507/1600 без переключений вообще. Нулевое отклонение часто объясняется сохранением базового метода, а не обученной способностью выбирать более эффективный.
- Результаты являются **синтетическими**; пространственно распределённая сеть, физическая обратная связь и доказательство многомерной устойчивости в этих сериях отсутствуют. Число 400 seed-блоков подтверждающей серии обозначает четыре группы f по 100 независимых индексированных повторов, а не 1600 независимых комбинаций факторов.

- [Поисковая серия М5-Б, GitHub Actions 44377834451](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44377834451): 80 ячеек, 1600 парных прогонов, 4800 вычислений. Средняя ΔRMSE относительно комбинированного E1: adaptive +0,010297, risk_aware +0,007194, regime_aware_discrete +0,000003. 79/80 ячеек дискретной политики без среднего отличия от E1, всего один переключавшийся прогон. В 16/64 сценариях pulsed стратегии не было активных атакующих тактов вследствие несовпадения временных окон.
- [Проверочная серия М5-Б, GitHub Actions 44379536743](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44379536743): 16 ячеек, 1280 парных прогонов, 3840 вычислений. ΔRMSE adaptive +0,018523, risk_aware +0,008067, regime_aware_discrete 0,000000. 1280/1280 без переключений; новые критерии адаптации не подтвердили преимущество. Архивы прошли арифметический аудит.
- [Программный этап М6, GitHub Actions 44382164288](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44382164288): Vite, тесты Node и Python, browser smoke — успешно. Обновлённый постпроцессор сверяет RMSE, покрытие, потери с первичными траекториями, экспортирует все прогоны и фазы.
- [Предварительный этап М7, GitHub Actions 44383136407](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44383136407): исходное E1 сохранено, полный синтетический пилот стоимости пройден. Достоверность реального времени и изолированная CPU стоимость политики не установлены.

- [Проверенный пилот стоимости М7, GitHub Actions 44383283110](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44383283110): 128 полных измеренных прогонов, 24 прогрева, 8 групп. Медианы wall-time в режиме общего оценивателя: adaptive 57,354 мс, risk_aware 57,563 мс, discrete 58,850 мс, blend 59,007 мс; при decision_feedback: 263,747; 264,119; 267,367; 270,108 мс. Нельзя отождествлять эти числа со стоимостью только alpha. [Отчёт](adaptive-cost-reference-results-2026-11-18.md).

- [Новая исследовательская серия v2, GitHub Actions 44504426592](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44504426592): 48 ячеек ×12 парных повторов ×5 политик, всего 2880 симуляций. Дискретная v2 относительно combined E1: средняя ΔRMSE **−0,000048**, лишь 3/48 ячеек с преимуществом, 18 переключений на 576 прогонов. [Отчёт](adaptive-regime-aware-v2-training-results-2026-11-19.md).
- [Новая подтверждающая серия v2, GitHub Actions 44505081250](https://github.com/kadet-ilia/IMAS-lab/actions/runs/44505081250): 12 ячеек ×60 повторов ×5 политик, 3600 симуляций; совпадают расчётные sourceHash и planHash с train. Дискретная v2: **+0,00009894** ΔRMSE, 0/12 выигрышей, 2 ухудшения; локально при lagged/f12 (p_{Holm}=0,00293) для ухудшения, условно применимости знакоперестановочного теста. [Отчёт](adaptive-regime-aware-v2-confirmatory-results-2026-11-19.md).

## Решение

1. Не включать regime_aware по умолчанию и не объявлять его улучшением по сравнению с proposed_robust.
2. Не изменять исходные алгоритмы E1 и не подгонять коэффициенты по уже изученной подтверждающей серии.
3. Сохранить текущий режим для диагностики и исследовательских экспериментов, с явными предупреждениями об ограничениях.
4. Вторая версия **regime_aware v2** разработана и проверена на новых seed и OOD сочетаниях без подбора по ранее раскрытым проверочным наборам. Гипотеза практически значимого улучшения **не подтверждена**; дальнейшие изменения требуют самостоятельной версии и новой независимой проверочной серии.
5. Прежде чем переносить метод на network_feedback/network_routed, разработать независимую модель доверительных свидетельств/несмещённого опорного сигнала, учесть искусственное расхождение режимов, измерить вычислительные накладные расходы самого селектора и доказать преимущества на новой, ещё не использованной серии. При отрицательном результате оставить v2 диагностическим режимом.

## Контроль реализации

Проверенные сборка и регрессии М6: GitHub Actions Verify IMAS_Lab 44382164288 (успешно). Проверка новых сценариев M7 выполняется тем же CI для последующих коммитов; успех предыдущей сборки не подтверждает автоматически более поздние изменения. Вычислительная версия frozen, SHA-256 и проверка парности сохранены. Дополнительная проверка научного ZIP на этапе CI реализована в workflow для следующих запусков. Состояние развёрнутого Cloudflare-сайта требует отдельного подтверждения: успешный GitHub CI не доказывает факт публикации.

### Связанные документы
- adaptive-modernization-roadmap-2026-11-18.md
- adaptive-regime-aware-mathematical-model.md
- adaptive-fkl-scientific-protocol.md
- adaptive-fkl-exploratory-results-2026-11-18.md
- adaptive-fkl-confirmatory-results-2026-11-18.md
- adaptive-periodic-correlation-preregistration.md
- adaptive-periodic-exploratory-results-2026-11-18.md
- adaptive-periodic-confirmatory-results-2026-11-18.md
- adaptive-study-diagnostics-and-reproduction-model.md
- adaptive-cost-pilot-protocol.md
- adaptive-cost-reference-results-2026-11-18.md
- adaptive-regime-aware-v2-research-protocol.md
- adaptive-regime-aware-v2-training-results-2026-11-19.md
- adaptive-regime-aware-v2-confirmatory-results-2026-11-19.md
