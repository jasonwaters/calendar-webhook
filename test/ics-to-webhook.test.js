const assert = require("assert");
const {
  parseIcsToEvents,
  sortByStartTime,
  buildPayload,
} = require("../src/ics-to-webhook.js");

/**
 * Test Suite for ICS to Webhook
 * 
 * This suite validates:
 * - ICS parsing for single and recurring events
 * - All-day vs timed event detection  
 * - Timezone handling
 * - Date window filtering
 * - Event sorting
 * - Payload construction
 */

// ============================================================================
// Test Runner Setup
// ============================================================================

const testSuites = [];
let currentSuite = null;

function describe(name, fn) {
  currentSuite = { name, tests: [] };
  testSuites.push(currentSuite);
  fn();
  currentSuite = null;
}

function it(name, fn) {
  if (currentSuite) {
    currentSuite.tests.push({ name, fn });
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createIcsCalendar(events) {
  const eventsStr = events.join("\n");
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:Test Calendar
BEGIN:VTIMEZONE
TZID:America/Denver
BEGIN:DAYLIGHT
TZOFFSETFROM:-0700
TZOFFSETTO:-0600
TZNAME:MDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONON=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0600
TZOFFSETTO:-0700
TZNAME:MST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
${eventsStr}
END:VCALENDAR`;
}

function createSimpleEvent(uid, summary, startDate, endDate, allDay = false) {
  if (allDay) {
    const start = startDate.replace(/-/g, "");
    const end = endDate.replace(/-/g, "");
    return `BEGIN:VEVENT
UID:${uid}
SUMMARY:${summary}
DTSTART;VALUE=DATE:${start}
DTEND;VALUE=DATE:${end}
CREATED:20260101T120000Z
DTSTAMP:20260101T120000Z
END:VEVENT`;
  } else {
    const start = startDate.replace(/[-:]/g, "").replace(".000Z", "Z");
    const end = endDate.replace(/[-:]/g, "").replace(".000Z", "Z");
    return `BEGIN:VEVENT
UID:${uid}
SUMMARY:${summary}
DTSTART:${start}
DTEND:${end}
CREATED:20260101T120000Z
DTSTAMP:20260101T120000Z
END:VEVENT`;
  }
}

function createRecurringEvent(uid, summary, startDateTime, endDateTime, rrule, tzid = null) {
  const tz = tzid ? `TZID=${tzid}:` : ":";
  return `BEGIN:VEVENT
UID:${uid}
SUMMARY:${summary}
DTSTART;${tz}${startDateTime}
DTEND;${tz}${endDateTime}
RRULE:${rrule}
CREATED:20260101T120000Z
DTSTAMP:20260101T120000Z
END:VEVENT`;
}

function createRecurringOverrideEvent(
  uid,
  summary,
  recurrenceId,
  startDateTime,
  endDateTime,
  tzid = null,
) {
  const tzParam = tzid ? `;TZID=${tzid}` : "";
  return `BEGIN:VEVENT
UID:${uid}
SUMMARY:${summary}
RECURRENCE-ID${tzParam}:${recurrenceId}
DTSTART${tzParam}:${startDateTime}
DTEND${tzParam}:${endDateTime}
CREATED:20260101T120000Z
DTSTAMP:20260101T120000Z
END:VEVENT`;
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Basic Event Parsing", () => {
  it("should parse a simple timed event", () => {
    const ics = createIcsCalendar([
      createSimpleEvent("test-1", "Test Event", "20260415T100000Z", "20260415T110000Z", false)
    ]);
    
    const { events } = parseIcsToEvents(ics, "Test Source");
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].uid, "test-1");
    assert.strictEqual(events[0].summary, "Test Event");
    assert.strictEqual(events[0].all_day, false);
    assert.strictEqual(events[0].source, "Test Source");
    assert.strictEqual(events[0].start_date, "2026-04-15");
    assert.strictEqual(events[0].end_date, "2026-04-15");
  });

  it("should parse an all-day event", () => {
    const ics = createIcsCalendar([
      createSimpleEvent("test-2", "All Day Event", "2026-04-15", "2026-04-16", true)
    ]);
    
    const { events } = parseIcsToEvents(ics, "Test Source");
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].all_day, true);
    assert.strictEqual(events[0].start_date, "2026-04-15");
    assert.strictEqual(events[0].end_date, "2026-04-16");
  });

  it("should extract calendar name from X-WR-CALNAME", () => {
    const ics = createIcsCalendar([
      createSimpleEvent("test-4", "Event", "20260415T100000Z", "20260415T110000Z", false)
    ]);
    
    const { calendarName } = parseIcsToEvents(ics, "Test Source");
    
    assert.strictEqual(calendarName, "Test Calendar");
  });
});

describe("Recurring Event Expansion", () => {
  it("should expand weekly recurring event", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "recurring-1",
        "Weekly Meeting",
        "20260407T160000",
        "20260407T170000",
        "FREQ=WEEKLY",
        "America/Denver"
      )
    ]);
    
    const dateWindow = {
      minDate: new Date("2026-04-01"),
      maxDate: new Date("2026-04-30")
    };
    
    const { events } = parseIcsToEvents(ics, "Test Source", dateWindow);
    
    assert.ok(events.length >= 4, `Expected at least 4 occurrences, got ${events.length}`);
    
    events.forEach(e => {
      assert.strictEqual(e.summary, "Weekly Meeting");
      assert.strictEqual(e.all_day, false);
    });
  });

  it("should expand daily recurring event with COUNT", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "recurring-2",
        "Daily Standup",
        "20260407T090000",
        "20260407T091500",
        "FREQ=DAILY;COUNT=5",
        "America/Denver"
      )
    ]);
    
    const dateWindow = {
      minDate: new Date("2026-04-01"),
      maxDate: new Date("2026-04-30")
    };
    
    const { events } = parseIcsToEvents(ics, "Test Source", dateWindow);
    
    assert.strictEqual(events.length, 5, `Expected 5 occurrences, got ${events.length}`);
  });

  it("should handle recurring events outside date window", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "recurring-4",
        "Out of Range",
        "20260601T100000",
        "20260601T110000",
        "FREQ=WEEKLY",
        "America/Denver"
      )
    ]);
    
    const dateWindow = {
      minDate: new Date("2026-04-01"),
      maxDate: new Date("2026-04-30")
    };
    
    const { events } = parseIcsToEvents(ics, "Test Source", dateWindow);
    
    assert.strictEqual(events.length, 0, "Should not expand events outside date window");
  });

  it("should replace recurring occurrence with RECURRENCE-ID override", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "override-1",
        "Zac: Picklr",
        "20260414T160000",
        "20260414T180000",
        "FREQ=DAILY;COUNT=3",
        "America/Denver",
      ),
      createRecurringOverrideEvent(
        "override-1",
        "Zac: Picklr: We take/they pickup",
        "20260415T160000",
        "20260415T160000",
        "20260415T180000",
        "America/Denver",
      ),
    ]);

    const dateWindow = {
      minDate: new Date("2026-04-01"),
      maxDate: new Date("2026-04-30"),
    };

    const { events } = parseIcsToEvents(ics, "Family", dateWindow);

    const overriddenDateEvents = events.filter((event) => event.start_date === "2026-04-15");
    assert.strictEqual(overriddenDateEvents.length, 1, "Expected one event for overridden instance");
    assert.strictEqual(overriddenDateEvents[0].summary, "Zac: Picklr: We take/they pickup");

    assert.strictEqual(
      events.length,
      3,
      `Expected 3 total events (master count), got ${events.length}`,
    );
  });
});

describe("Timezone Handling", () => {
  it("should preserve local date for timezone-aware events", () => {
    const ics = createIcsCalendar([
      `BEGIN:VEVENT
UID:tz-test-1
SUMMARY:Mountain Time Event
DTSTART;TZID=America/Denver:20260407T160000
DTEND;TZID=America/Denver:20260407T180000
CREATED:20260101T120000Z
DTSTAMP:20260101T120000Z
END:VEVENT`
    ]);
    
    const { events } = parseIcsToEvents(ics, "Test Source");
    
    assert.strictEqual(events[0].start_date, "2026-04-07");
    assert.strictEqual(events[0].end_date, "2026-04-07");
    assert.strictEqual(events[0].all_day, false);
  });

  it("should correctly identify all-day for recurring events", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "tz-test-3",
        "Recurring Timed",
        "20260407T160000",
        "20260407T180000",
        "FREQ=WEEKLY;COUNT=3",
        "America/Denver"
      )
    ]);
    
    const dateWindow = {
      minDate: new Date("2026-04-01"),
      maxDate: new Date("2026-04-30")
    };
    
    const { events } = parseIcsToEvents(ics, "Test Source", dateWindow);
    
    events.forEach(e => {
      assert.strictEqual(e.all_day, false, `Occurrence on ${e.start_date} should not be all-day`);
    });
  });
});

describe("Event Sorting", () => {
  it("should sort events by start time", () => {
    const events = [
      { uid: "3", summary: "Third", start: "2026-04-15T10:00:00.000Z" },
      { uid: "1", summary: "First", start: "2026-04-10T10:00:00.000Z" },
      { uid: "2", summary: "Second", start: "2026-04-12T10:00:00.000Z" }
    ];
    
    const sorted = sortByStartTime(events);
    
    assert.strictEqual(sorted[0].summary, "First");
    assert.strictEqual(sorted[1].summary, "Second");
    assert.strictEqual(sorted[2].summary, "Third");
  });

  it("should handle events with null start times", () => {
    const events = [
      { uid: "2", summary: "Has start", start: "2026-04-15T10:00:00.000Z" },
      { uid: "1", summary: "No start", start: null }
    ];
    
    const sorted = sortByStartTime(events);
    
    assert.strictEqual(sorted[0].summary, "Has start");
    assert.strictEqual(sorted[1].summary, "No start");
  });
});

describe("Payload Building", () => {
  const testEvents = [
    { uid: "1", summary: "Event 1", start: "2026-04-10T10:00:00.000Z" },
    { uid: "2", summary: "Event 2", start: "2026-04-11T10:00:00.000Z" }
  ];

  it("should build payload without wrapper key", () => {
    const payload = buildPayload(testEvents, "Test Calendar", ["Source 1", "Source 2"], null);
    
    assert.strictEqual(payload.calendar_name, "Test Calendar");
    assert.strictEqual(payload.events.length, 2);
    assert.deepStrictEqual(payload.sources, ["Source 1", "Source 2"]);
    assert.ok(payload.generated_at);
  });

  it("should build payload with wrapper key", () => {
    const payload = buildPayload(testEvents, "Test Calendar", ["Source 1"], "merge_variables");
    
    assert.ok(payload.merge_variables);
    assert.strictEqual(payload.merge_variables.calendar_name, "Test Calendar");
    assert.strictEqual(payload.merge_variables.events.length, 2);
  });

  it("should handle empty events array", () => {
    const payload = buildPayload([], "Empty Calendar", [], null);
    
    assert.strictEqual(payload.events.length, 0);
    assert.strictEqual(payload.calendar_name, "Empty Calendar");
  });
});

describe("Edge Cases", () => {
  it("should handle empty calendar", () => {
    const ics = createIcsCalendar([]);
    const { events } = parseIcsToEvents(ics, "Empty Source");
    
    assert.strictEqual(events.length, 0);
  });

  it("should handle events with missing optional fields", () => {
    const ics = createIcsCalendar([
      `BEGIN:VEVENT
UID:minimal
SUMMARY:Minimal Event
DTSTART:20260415T100000Z
DTEND:20260415T110000Z
END:VEVENT`
    ]);
    
    const { events } = parseIcsToEvents(ics, "Test");
    
    assert.strictEqual(events[0].description, "");
    assert.strictEqual(events[0].location, "");
    assert.strictEqual(events[0].status, "");
  });

  it("should handle very long recurring series (safety limit)", () => {
    const ics = createIcsCalendar([
      createRecurringEvent(
        "infinite",
        "Daily Forever",
        "20260101T100000",
        "20260101T110000",
        "FREQ=DAILY",
        "America/Denver"
      )
    ]);
    
    const dateWindow = {
      minDate: new Date("2026-01-01"),
      maxDate: new Date("2030-12-31")
    };
    
    const { events } = parseIcsToEvents(ics, "Test", dateWindow);
    
    assert.ok(events.length <= 1000, `Should limit to 1000 occurrences, got ${events.length}`);
  });

  it("should handle events at midnight boundary", () => {
    const ics = createIcsCalendar([
      createSimpleEvent("midnight", "Midnight Event", "20260415T000000Z", "20260415T010000Z", false)
    ]);
    
    const { events } = parseIcsToEvents(ics, "Test");
    
    assert.strictEqual(events[0].start_date, "2026-04-15");
    assert.ok(events[0].start.includes("00:00:00"));
  });
});

// ============================================================================
// Test Runner
// ============================================================================

function runTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  testSuites.forEach(suite => {
    console.log(`\n${suite.name}`);
    console.log("=".repeat(80));
    
    suite.tests.forEach(test => {
      totalTests++;
      try {
        test.fn();
        console.log(`  ✓ ${test.name}`);
        passedTests++;
      } catch (error) {
        console.log(`  ✗ ${test.name}`);
        console.log(`    ${error.message}`);
        if (error.stack) {
          const stackLines = error.stack.split('\n').slice(1, 3);
          console.log(`    ${stackLines.join('\n    ')}`);
        }
        failedTests++;
      }
    });
  });
  
  console.log("\n" + "=".repeat(80));
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  
  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
