#!/usr/bin/env node

/**
 * ICS to Webhook - Multi-Calendar Edition
 *
 * Combines multiple ICS calendars and sends to webhooks with source tracking.
 * Configured via config/webhooks.json for easy management of multiple webhooks.
 *
 * Usage:
 *   node src/ics-to-webhook.js [--config path] [--dry-run]
 *
 * Options:
 *   --config <path>   Path to config file (default: config/webhooks.json)
 *   --dry-run         Print JSON payloads to stdout without POSTing
 *   --help, -h        Show this help message
 */

const fs = require("fs").promises;
const path = require("path");
const ICAL = require("ical.js");

function printUsage() {
  console.log(`
ICS to Webhook — Combine multiple calendars and POST to webhooks

Usage:
  node src/ics-to-webhook.js [options]
  npm start [-- options]

Options:
  --config <path>     Path to config file (default: config/webhooks.json)
  --dry-run           Print JSON payloads without POSTing
  --help, -h          Show this help message

Configuration:
  Create config/webhooks.json with an array of webhook configurations.
  See config/webhooks.example.json for format.

Examples:
  npm start
  npm start -- --dry-run
  npm start -- --config my-webhooks.json
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    configPath: "config/webhooks.json",
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--config") {
      options.configPath = args[++i];
      if (!options.configPath) {
        console.error("Error: --config requires a value");
        process.exit(1);
      }
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      console.error(`Error: Unknown option "${arg}"`);
      printUsage();
      process.exit(1);
    }
  }

  return options;
}

// ============================================================================
// ICS Loading Functions (reused from original)
// ============================================================================

function isUrl(value) {
  return /^(https?|webcal):\/\//i.test(value);
}

async function fetchIcsFromUrl(url) {
  const normalizedUrl = url.replace(/^webcal:\/\//i, "https://");

  const response = await fetch(normalizedUrl, {
    headers: {
      Accept: "text/calendar, */*",
      "User-Agent": "calendar-webhook",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ICS from ${normalizedUrl}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

async function readIcsFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  return fs.readFile(resolvedPath, "utf8");
}

async function loadIcsContent(source) {
  if (isUrl(source)) {
    return fetchIcsFromUrl(source);
  }
  return readIcsFile(source);
}

function extractCalendarName(component) {
  const name =
    component.getFirstPropertyValue("x-wr-calname") ||
    component.getFirstPropertyValue("name");
  return name || "Calendar";
}

function isAllDayEvent(vevent) {
  const dtstart = vevent.getFirstProperty("dtstart");
  if (!dtstart) return false;
  return dtstart.type === "date";
}

function eventToJson(vevent, source, occurrenceStart = null, occurrenceEnd = null) {
  const event = new ICAL.Event(vevent);
  
  const startDate = occurrenceStart || event.startDate;
  const endDate = occurrenceEnd || event.endDate;

  const allDay = occurrenceStart 
    ? (occurrenceStart.isDate || false)
    : isAllDayEvent(vevent);

  const startJs = startDate ? startDate.toJSDate() : null;
  const endJs = endDate ? endDate.toJSDate() : null;

  const getLocalDateString = (icalTime) => {
    if (!icalTime) return null;
    const year = icalTime.year;
    const month = String(icalTime.month).padStart(2, '0');
    const day = String(icalTime.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    uid: event.uid || null,
    summary: event.summary || "",
    description: event.description || "",
    status: vevent.getFirstPropertyValue("status") || "",
    location: event.location || "",
    start: startJs ? startJs.toISOString() : null,
    end: endJs ? endJs.toISOString() : null,
    all_day: allDay,
    start_date: getLocalDateString(startDate),
    end_date: getLocalDateString(endDate),
    source: source,
  };
}

function expandRecurringEvent(event, vevent, dateWindow, source) {
  const occurrences = [];
  
  const { minDate, maxDate } = dateWindow;
  
  const expand = event.iterator();
  let next;
  let count = 0;
  const maxOccurrences = 1000;

  while ((next = expand.next()) && count < maxOccurrences) {
    count++;
    
    const occurrenceStart = next;
    const duration = event.duration;
    const occurrenceEnd = occurrenceStart.clone();
    occurrenceEnd.addDuration(duration);

    const startJs = occurrenceStart.toJSDate();
    const endJs = occurrenceEnd.toJSDate();

    if (startJs > maxDate) {
      break;
    }

    if (endJs >= minDate && startJs <= maxDate) {
      occurrences.push(eventToJson(vevent, source, occurrenceStart, occurrenceEnd));
    }
  }

  return occurrences;
}

function parseIcsToEvents(icsContent, sourceName, dateWindow = null) {
  const jcalData = ICAL.parse(icsContent);
  const component = new ICAL.Component(jcalData);
  const calendarName = extractCalendarName(component);

  const vevents = component.getAllSubcomponents("vevent");
  const events = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);

    if (event.isRecurring() && dateWindow) {
      const occurrences = expandRecurringEvent(event, vevent, dateWindow, sourceName);
      events.push(...occurrences);
    } else {
      events.push(eventToJson(vevent, sourceName));
    }
  }

  return { events, calendarName };
}

function sortByStartTime(events) {
  return events.sort((a, b) => {
    if (!a.start) return 1;
    if (!b.start) return -1;
    return a.start.localeCompare(b.start);
  });
}

// ============================================================================
// New Multi-Source Functions
// ============================================================================

async function loadConfig(configPath) {
  const resolvedPath = path.resolve(configPath);
  const content = await fs.readFile(resolvedPath, "utf8");
  return JSON.parse(content);
}

function isValidWebhookTarget(target) {
  return (
    typeof target === "object" &&
    target !== null &&
    typeof target.webhookUrl === "string" &&
    target.webhookUrl.trim().length > 0
  );
}

function normalizeWebhookTargets(config) {
  if (Array.isArray(config.webhookUrls) && config.webhookUrls.length > 0) {
    return config.webhookUrls.map((target, index) => {
      if (typeof target === "string" && target.trim().length > 0) {
        return { webhookUrl: target };
      }

      if (isValidWebhookTarget(target)) {
        return target;
      }

      throw new Error(
        `Config "${config.name}" has invalid webhookUrls[${index}]. Expected a non-empty URL string or an object containing "webhookUrl".`,
      );
    });
  }

  if (typeof config.webhookUrl === "string" && config.webhookUrl.trim().length > 0) {
    console.warn(
      `   ⚠️  "${config.name}" uses deprecated "webhookUrl"; migrate to "webhookUrls" array.`,
    );
    return [{ webhookUrl: config.webhookUrl }];
  }

  throw new Error(
    `Config "${config.name}" must include "webhookUrls" as a non-empty array`,
  );
}

function extractSourceLabel(sourceConfig, icsContent, icsPath) {
  // Priority: config label > X-WR-CALNAME > filename
  if (sourceConfig.label) {
    return sourceConfig.label;
  }

  // Try to extract X-WR-CALNAME
  try {
    const jcalData = ICAL.parse(icsContent);
    const component = new ICAL.Component(jcalData);
    const calName = extractCalendarName(component);
    if (calName !== "Calendar") {
      return calName;
    }
  } catch {
    // Fall through to filename
  }

  // Use filename
  if (!isUrl(icsPath)) {
    return path.basename(icsPath, ".ics");
  }

  return "Calendar";
}

async function loadMultipleSources(sources, dateWindow) {
  const allEvents = [];
  const sourceLabels = [];

  for (const sourceConfig of sources) {
    const icsPath = sourceConfig.icsPath;
    console.log(`   Loading: ${icsPath}`);

    const icsContent = await loadIcsContent(icsPath);
    const sourceLabel = extractSourceLabel(sourceConfig, icsContent, icsPath);
    sourceLabels.push(sourceLabel);

    const { events } = parseIcsToEvents(icsContent, sourceLabel, dateWindow);
    console.log(`   Found ${events.length} events from "${sourceLabel}"`);

    allEvents.push(...events);
  }

  return { events: allEvents, sources: sourceLabels };
}

function calculateDateWindow(config) {
  const dateWindow = config.dateWindow || { mode: "smart", futureMonths: 2 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let minDate, maxDate;

  if (dateWindow.mode === "smart") {
    const futureMonths = dateWindow.futureMonths || 2;
    
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    minDate = new Date(firstOfMonth);
    minDate.setDate(minDate.getDate() - 7);
    
    maxDate = new Date(today.getFullYear(), today.getMonth() + futureMonths + 1, 0);
  } else {
    const pastDays = dateWindow.pastDays || 7;
    const futureDays = dateWindow.futureDays || 60;
    
    minDate = new Date(today);
    minDate.setDate(minDate.getDate() - pastDays);
    
    maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + futureDays);
  }

  return { minDate, maxDate };
}

function filterByDateWindow(events, config) {
  const { minDate, maxDate } = calculateDateWindow(config);

  const minDateStr = minDate.toISOString().split("T")[0];
  const maxDateStr = maxDate.toISOString().split("T")[0];

  return events.filter((event) => {
    const endDate = event.end_date || event.start_date;
    const startDate = event.start_date;
    return endDate >= minDateStr && startDate <= maxDateStr;
  });
}

function buildPayload(events, calendarName, sources, payloadKey) {
  const data = {
    events,
    calendar_name: calendarName,
    sources: sources,
    generated_at: new Date().toISOString(),
  };

  if (payloadKey) {
    return { [payloadKey]: data };
  }

  return data;
}

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "calendar-webhook",
      Accept: "*/*",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Webhook POST failed: ${response.status} ${response.statusText}`,
    );
  }

  return response;
}

async function processWebhookConfig(config, dryRun) {
  const webhookTargets = normalizeWebhookTargets(config);

  console.log(`\n📅 Processing: ${config.name}`);
  console.log(`   Sources: ${config.sources.length}`);
  console.log(`   Webhook destinations: ${webhookTargets.length}`);

  try {
    const dateWindow = calculateDateWindow(config);
    
    const { events: allEvents, sources: sourceLabels } =
      await loadMultipleSources(config.sources, dateWindow);
    console.log(`   Total events loaded: ${allEvents.length}`);

    let events = filterByDateWindow(allEvents, config);
    console.log(`   Events in date window: ${events.length}`);

    events = sortByStartTime(events);

    const payload = buildPayload(
      events,
      config.name,
      sourceLabels,
      config.payloadKey,
    );

    if (dryRun) {
      console.log("\n--- Dry run: payload below ---\n");
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`\n📤 POSTing ${events.length} events to ${webhookTargets.length} webhook(s)`);
    if (config.payloadKey) {
      console.log(`   Payload wrapped in key: "${config.payloadKey}"`);
    }

    for (const target of webhookTargets) {
      if (target.title) {
        console.log(`   → ${target.title}: ${target.webhookUrl}`);
      } else {
        console.log(`   → ${target.webhookUrl}`);
      }
      await postWebhook(target.webhookUrl, payload);
    }
    console.log("✅ Webhook POST successful!");
  } catch (error) {
    console.error(`\n✗ Error processing "${config.name}": ${error.message}`);
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv);

  try {
    console.log(`📋 Loading config from: ${options.configPath}`);
    const configs = await loadConfig(options.configPath);

    if (!Array.isArray(configs) || configs.length === 0) {
      console.error("Error: Config must be an array with at least one webhook");
      process.exit(1);
    }

    console.log(`   Found ${configs.length} webhook configuration(s)`);

    // Process each webhook config
    for (const config of configs) {
      await processWebhookConfig(config, options.dryRun);
    }

    console.log(`\n✅ All webhooks processed successfully!`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`\n✗ Error: Config file not found: ${options.configPath}`);
      console.error(`   Create it from config/webhooks.example.json`);
    } else {
      console.error(`\n✗ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseIcsToEvents,
  loadMultipleSources,
  filterByDateWindow,
  sortByStartTime,
  buildPayload,
};
