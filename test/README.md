# ICS to Webhook Test Suite

Comprehensive test suite for validating the calendar webhook functionality.

## Running Tests

```bash
npm test
```

## Test Coverage

### 1. Basic Event Parsing

Tests core ICS parsing functionality:

- **Simple timed events** - Validates parsing of events with specific start/end times in UTC
- **All-day events** - Ensures proper detection and handling of all-day events using `VALUE=DATE`
- **Calendar name extraction** - Verifies extraction of calendar name from `X-WR-CALNAME` property

### 2. Recurring Event Expansion

Tests the handling of recurring events (RRULE):

- **Weekly recurring events** - Validates expansion of weekly recurring patterns
- **Daily recurring with COUNT** - Tests events with a limited number of occurrences
- **Events outside date window** - Ensures events outside the configured window are not expanded

**Key validation**: Recurring events should be expanded into individual occurrences within the date window, not returned as a single event.

### 3. Timezone Handling

Critical tests for timezone-aware events:

- **Local date preservation** - Validates that `start_date` and `end_date` reflect the **local timezone** date, not UTC
  - Example: Event at 4pm-6pm Mountain Time on April 7 should show dates as `2026-04-07`, even though UTC time crosses to April 8
- **All-day detection for recurring events** - Ensures recurring timed events are not incorrectly marked as all-day

**Known behavior**: The `start` and `end` fields contain ISO timestamps in UTC, while `start_date` and `end_date` contain the date in the event's local timezone.

### 4. Event Sorting

Tests chronological ordering:

- **Sort by start time** - Events ordered chronologically by start timestamp
- **Null start times** - Events without start times should sort to the end

### 5. Payload Building

Tests JSON payload construction:

- **Payload without wrapper** - Direct data structure for simple webhooks
- **Payload with wrapper key** - Wrapped in specified key (e.g., `merge_variables`) for specific webhook formats
- **Empty events** - Validates proper handling of calendars with no events

### 6. Edge Cases

Tests boundary conditions and error scenarios:

- **Empty calendars** - No events in calendar
- **Missing optional fields** - Events without description, location, or status
- **Very long recurring series** - Safety limit of 1000 occurrences to prevent infinite loops
- **Midnight boundary events** - Events at exactly 00:00:00

## Test Structure

Tests use a minimal custom test runner (no external dependencies beyond `assert` and `ical.js`):

```javascript
describe("Test Suite", () => {
  it("should do something", () => {
    assert.strictEqual(actual, expected);
  });
});
```

## Known Issues & Gotchas

### Timezone Date Handling

The most complex aspect of this system is timezone-aware date handling. The implementation correctly:

1. Preserves timezone information during parsing
2. Converts to UTC for ISO timestamps (`start`, `end`)
3. Extracts local dates for `start_date` and `end_date` fields

This prevents issues like:
- A 6pm event showing as spanning two days (when UTC conversion crosses midnight)
- Recurring events with specific times being marked as all-day

### Recurring Event Safety

To prevent infinite loops or excessive memory usage, recurring event expansion:
- Limits to 1000 occurrences maximum
- Only expands events within the configured date window
- Stops iteration once events exceed the maximum date

## Adding New Tests

To add new tests:

1. Add a new `describe()` block for a new category, or
2. Add an `it()` test within an existing `describe()` block

```javascript
describe("My New Feature", () => {
  it("should handle X correctly", () => {
    // Arrange
    const input = createTestData();
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    assert.strictEqual(result.foo, "expected");
  });
});
```

## Test Helpers

### `createIcsCalendar(events)`

Creates a valid VCALENDAR with specified events and America/Denver timezone.

### `createSimpleEvent(uid, summary, start, end, allDay)`

Creates a basic VEVENT for testing:
- For timed events: Use ISO format `"20260415T100000Z"`
- For all-day: Use date format `"2026-04-15"`

### `createRecurringEvent(uid, summary, start, end, rrule, tzid)`

Creates a recurring VEVENT with specified recurrence rule.

## Future Test Additions

Potential areas for additional testing:

- [ ] EXDATE (exception dates) handling
- [ ] Modified recurring instances (RECURRENCE-ID)
- [ ] Multiple calendars with conflicting timezones
- [ ] Events with missing required fields
- [ ] Malformed ICS data
- [ ] Network failure scenarios (for URL fetching)
- [ ] Webhook POST failure handling
