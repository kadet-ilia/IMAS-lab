# Проверка кодировок проекта ИМАС 3.2

Проверка выполнена для исходных файлов Python, JavaScript/JSX, JSON, Markdown, HTML, CSS, shell- и batch-скриптов.

## Принятая политика

- исходные тексты, JSON, HTML, CSS, JavaScript, Python и документация: UTF-8;
- Windows batch-файлы: только ASCII, окончания строк CRLF;
- обмен Node.js ↔ Python: UTF-8, `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `python -X utf8`;
- CSV для Microsoft Excel: UTF-8 with BOM, разделитель `;`;
- HTML: `<meta charset="UTF-8">`;
- загружаемые JSON и SVG: MIME-типы с `charset=utf-8`;
- SVG: XML-декларация `encoding="UTF-8"`.

## Результаты

- 35 текстовых файлов проверены после production-сборки;
- недопустимые UTF-8-последовательности не выявлены;
- распространённые признаки ошибочного декодирования UTF-8 в содержимом проекта не выявлены;
- batch-файлы не содержат не-ASCII-символов и используют CRLF;
- JSON-файлы успешно разобраны стандартным парсером;
- русскоязычные сообщения прогресса успешно переданы через stderr Python и прочитаны как UTF-8;
- CSV-журналы подтверждены сигнатурой BOM `EF BB BF`;
- браузерная проверка: ошибок и предупреждений консоли не выявлено.

## Команды повторной проверки

```bat
check_encoding.bat
```

```powershell
.venv\Scripts\python.exe -X utf8 encoding_audit.py
```

```powershell
.venv\Scripts\python.exe -X utf8 -m unittest -v
```
