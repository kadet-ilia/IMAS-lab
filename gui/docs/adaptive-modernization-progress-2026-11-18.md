# Журнал выполнения модернизации раздела «Адаптивные решения» (18.11.2026)

**Репозиторий:** kadet-ilia/IMAS-lab, ветка IMAS_Lab_test. **Основание:** adaptive-modernization-roadmap-2026-11-18.md. **Статус:** завершены факторные исследования М5-А и М5-Б, расширена послерасчётная аналитика М6 и запущены измерения М7. Ввод режима regime_aware как предпочтительного алгоритма **отклонён по результатам независимых испытаний**; новый v2 пока не создан и не испытан.

## Выполненные задачи по этапам плана

| Этап | Состояние | Доказательства и ограничения |
|---|---|---|
| М0 — фиксация исторического контроля | Выполнен для E1-А/f-k-L | Пять исторических ID сохранены, E1 baseline проверяется попарно, версии и SHA-256 источников входят в архив |
| М1 — уточнение эффективности | Реализовано | Основной контроль proposed_robust, вторичный trimmed_unweighted, условный RMSE и безусловная потеря со штрафом отказа |
| М2 — диагностика режима | Исследовательский прототип | EWMA + CUSUM, память, порог и гистерезис; не идентифицирует тип реальной атаки |
| М3 — политика выбора оценивателей | Исследовательский прототип | Дискретный и непрерывный regime_aware, причинность, общий безопасный интервал, отсутствие оракула |
| М4 — пригодность свидетельств | Частично | Учитываются доступность, N_eff, модельные lag и корреляция; нет измеренной независимости источников, калибровки или защиты от сговора |
| М5 — факторные исследования | Проведены серии А и Б | f×k×L: 80×30×4 и 16×100×4; периодичность/корреляция: 80×20×3 и 16×80×3. Эффективность regime_aware не подтверждена. Нет отдельного обучения и независимого holdout для будущей версии v2 |
| М6 — интерфейс | Реализовано ядро сравнительной аналитики | Существующие диаграммы + просмотр архивов М5-А/Б; распределение по полным прогонам, фазовые ΔRMSE, отказо-устойчивая безусловная потеря, 4 формата экспорта и паспорт воспроизводимости. Интерактивные навигационные сценарии и расширенный E2E ещё требуют проверки |
| М7 — верификация | Выполняется программно-экспериментальная часть | Node/Python, Vite, браузерный smoke, арифметический контроль архивов и измерение времени целого прогона/CPU в двух режимах. Отдельная аппаратная проверка, изолированная стоимость alpha и полевые данные отсутствуют |
| М8 — научное описание | Выполнено для текущего этапа | Математический паспорт, preregistration, отрицательные результаты обеих серий, журнал ограничений |

## Ключевые исходные файлы

- gui/src/adaptiveRegimeDetector.js
- gui/src/adaptiveEvidenceQuality.js
- gui/src/adaptivePolicySelector.js
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
- gui/scripts/adaptivePeriodicCampaign.mjs
- gui/scripts/auditPeriodicCampaign.py
- gui/scripts/adaptiveCostBenchmark.mjs
- gui/scripts/auditCostBenchmark.py
- gui/scripts/auditFklResults.py
- tests/gui/adaptiveRegimePolicy.test.mjs
- tests/gui/adaptiveFklCampaign.test.mjs
- tests/gui/adaptiveFklResults.test.mjs
- tests/gui/adaptivePeriodicCampaign.test.mjs
- tests/gui/adaptivePeriodicResults.test.mjs
- tests/gui/adaptiveExposureDiagnostics.test.mjs
- tests/gui/adaptiveStudyDiagnostics.test.mjs
- tests/gui/adaptiveCostProtocol.test.mjs
- tests/python/test_adaptive_fkl_audit.py
- .github/workflows/adaptive-e1a-fkl-factorial.yml
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

## Решение

1. Не включать regime_aware по умолчанию и не объявлять его улучшением по сравнению с proposed_robust.
2. Не изменять исходные алгоритмы E1 и не подгонять коэффициенты по уже изученной подтверждающей серии.
3. Сохранить текущий режим для диагностики и исследовательских экспериментов, с явными предупреждениями об ограничениях.
4. В новой ветке исследовательского дизайна подготовить **regime_aware v2**: определить новую наблюдаемую функцию качества экспертов, отдельно измерять пригодность источников, ограничение переключений и стоимость false fallback; выполнять подбор параметров на **новых обучающих** сценариях.
5. До публикационных выводов потребовать новую независимо выделенную подтверждающую серию нового алгоритма, разделить типы атак, количественно оценить потери от отказа и переключения и лишь затем переходить к network_feedback/network_routed.

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
