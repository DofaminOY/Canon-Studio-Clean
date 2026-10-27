// Разбор бинарного IPP-ответа принтера.
export function parseIPPResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 9) {
    throw new Error("Слишком короткий IPP-ответ.");
  }

  const result = {
    version: `${buffer[0]}.${buffer[1]}`,
    status: buffer.readUInt16BE(2),
    requestId: buffer.readUInt32BE(4),
    attributes: {},
  };

  let offset = 8;
  let currentName = "";
  let endFound = false;

  while (offset < buffer.length) {
    const tag = buffer[offset++];

    // Разделители групп атрибутов и конец IPP-сообщения.
    if (tag === 0x03) {
      endFound = true;
      break;
    }

    if (tag >= 0x01 && tag <= 0x0f) {
      currentName = "";
      continue;
    }

    if (offset + 2 > buffer.length) {
      throw new Error("Поврежден IPP-ответ: нет длины имени.");
    }

    const nameLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (offset + nameLength + 2 > buffer.length) {
      throw new Error("Поврежден IPP-ответ: неполное имя атрибута.");
    }

    if (nameLength > 0) {
      currentName = buffer.toString("utf8", offset, offset + nameLength);
    }
    offset += nameLength;

    const valueLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (offset + valueLength > buffer.length) {
      throw new Error("Поврежден IPP-ответ: неполное значение.");
    }

    const value = buffer.subarray(offset, offset + valueLength);
    offset += valueLength;

    if (!currentName) {
      throw new Error("Поврежден IPP-ответ: атрибут без имени.");
    }

    const decoded = decodeIPPValue(tag, value);
    if (!Object.hasOwn(result.attributes, currentName)) {
      result.attributes[currentName] = [];
    }
    result.attributes[currentName].push(decoded);
  }

  if (!endFound) {
    throw new Error("Поврежден IPP-ответ: нет конечного тега 0x03.");
  }

  return result;
}

// Преобразуем типы IPP в обычные значения JavaScript.
function decodeIPPValue(tag, value) {
  if ((tag === 0x21 || tag === 0x23) && value.length === 4) {
    return value.readInt32BE(0);
  }

  if (tag === 0x22 && value.length === 1) {
    return value[0] !== 0;
  }

  if (tag === 0x32 && value.length === 9) {
    const units = value[8] === 3 ? "dpi" : value[8] === 4 ? "dpcm" : "units";
    return `${value.readInt32BE(0)}x${value.readInt32BE(4)} ${units}`;
  }

  if (tag === 0x33 && value.length === 8) {
    return `${value.readInt32BE(0)}-${value.readInt32BE(4)}`;
  }

  // Строковые типы IPP: текст, имена, URI, ключевые слова и MIME-типы.
  if (tag >= 0x41 && tag <= 0x49) {
    return value.toString("utf8");
  }

  // Специальные значения IPP, например «неизвестно».
  if (tag >= 0x10 && tag <= 0x1f) {
    return null;
  }

  // Прочие бинарные значения сохраняем как HEX, без потери данных.
  return `0x${value.toString("hex")}`;
}

// Получаем все значения атрибута или пустой массив.
export function getValues(attributes, name) {
  return attributes[name] || [];
}

// Получаем первое значение атрибута или значение по умолчанию.
export function getValue(attributes, name, fallback = "неизвестно") {
  return getValues(attributes, name)[0] ?? fallback;
}

// Печатаем удобный отчет о состоянии принтера.
export function printPrinterReport(result, showAll = false) {
  const attributes = result.attributes;
  const states = { 3: "Готов (idle)", 4: "Печатает (processing)", 5: "Остановлен (stopped)" };
  const qualities = { 3: "Черновик", 4: "Стандартное", 5: "Высокое" };

  console.log("\n========== CANON TS5350i ==========");
  console.log(`Модель: ${getValue(attributes, "printer-make-and-model")}`);
  console.log(`Прошивка: ${getValue(attributes, "printer-firmware-string-version")}`);
  console.log(`Состояние: ${states[getValue(attributes, "printer-state")] || "Неизвестное"}`);
  console.log(`Причины состояния: ${getValues(attributes, "printer-state-reasons").join(", ") || "не указаны"}`);
  console.log(`Принимает задания: ${getValue(attributes, "printer-is-accepting-jobs", false) ? "да" : "нет"}`);
  console.log(`Заданий в очереди: ${getValue(attributes, "queued-job-count")}`);

  console.log("\n--- Возможности печати ---");
  console.log(`Форматы: ${getValues(attributes, "document-format-supported").join(", ")}`);
  console.log(`Разрешение: ${getValues(attributes, "printer-resolution-supported").join(", ")}`);
  console.log(`Качество: ${getValues(attributes, "print-quality-supported").map((v) => qualities[v] || v).join(", ")}`);
  console.log(`Цвет: ${getValues(attributes, "print-color-mode-supported").join(", ")}`);
  console.log(`Стороны: ${getValues(attributes, "sides-supported").join(", ")}`);
  console.log(`Бумага по умолчанию: ${getValue(attributes, "media-default")}`);

  console.log("\n--- Картриджи ---");
  const names = getValues(attributes, "marker-names");
  const levels = getValues(attributes, "marker-levels");
  for (let i = 0; i < names.length; i++) {
    const level = levels[i];
    // По стандарту IPP -2 означает, что уровень неизвестен.
    const text = typeof level === "number" && level >= 0 ? `${level}%` : "уровень неизвестен";
    console.log(`${names[i]}: ${text}`);
  }
  console.log(`Страница чернил: ${getValue(attributes, "printer-supply-info-uri")}`);
  console.log(`\nВсего разных атрибутов: ${Object.keys(attributes).length}`);

  if (showAll) {
    console.log("\n--- Все атрибуты ---");
    for (const [name, values] of Object.entries(attributes)) {
      console.log(`${name}: ${values.map((value) => String(value)).join(", ")}`);
    }
  }
}
