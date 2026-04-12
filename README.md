# Calendar Webhook

Combine multiple ICS calendars and send to webhooks with multi-source tracking. Works with any webhook endpoint that accepts JSON. Also useful for [TRMNL](https://github.com/jasonwaters/trmnl) BYOS users.

## Features

- ✅ **Multi-calendar support** - Combine events from multiple ICS files (local or URLs)
- ✅ **Source tracking** - Each event tagged with its source calendar
- ✅ **Recurring event support** - Automatically expands recurring events (RRULE) into individual occurrences
- ✅ **Smart date windowing** - Month-boundary-aware date filtering for calendar views
- ✅ **Timezone-aware** - Properly handles timezone-specific events and preserves local dates
- ✅ **Multiple webhooks** - Send different calendar combinations to different endpoints
- ✅ **Flexible configuration** - JSON config file for easy management
- ✅ **Comprehensive tests** - 17 test cases covering edge cases and functionality

## Installation

```bash
npm install
```

## Quick Start

1. **Copy the example config:**
   ```bash
   cp config/webhooks.example.json config/webhooks.json
   ```

2. **Edit `config/webhooks.json`** with your calendars and webhook URLs

3. **Run the script:**
   ```bash
   npm start
   ```

4. **Test with dry-run:**
   ```bash
   npm start -- --dry-run
   ```

## Configuration

### File: `config/webhooks.json`

The config file contains an array of webhook configurations. Each configuration combines one or more ICS calendars and sends the combined events to a webhook endpoint.

### Basic Example

```json
[
  {
    "name": "My Combined Calendar",
    "webhookUrl": "https://usetrmnl.com/api/custom_plugins/abc123",
    "sources": [
      {
        "icsPath": "../rental-calendar-sync/output/reservations-2026.ics",
        "label": "Rentals"
      },
      {
        "icsPath": "https://calendar.google.com/calendar/ical/you@gmail.com/basic.ics",
        "label": "Personal"
      }
    ],
    "payloadKey": "merge_variables",
    "dateWindow": {
      "mode": "smart",
      "futureMonths": 2
    }
  }
]
```

### Configuration Fields

#### `name` (required)
- Display name for the combined calendar
- Becomes the `calendar_name` field in the webhook payload
- Example: `"Family & Rentals"`, `"Office Display"

#### `webhookUrl` (required)
- The webhook endpoint to POST calendar data to
- Can be any webhook endpoint that accepts JSON

#### `sources` (required, array)
- Array of ICS calendar sources to combine
- Each source has:
  - **`icsPath`** (required): Local file path or URL (http/https/webcal)
  - **`label`** (optional): Display name for this source
    - Takes precedence over X-WR-CALNAME from ICS file
    - Used as the `source` field on each event

#### `payloadKey` (optional)
- If specified, wraps the payload in a named key
- Example: `"merge_variables"` produces:
  ```json
  {
    "merge_variables": {
      "events": [...],
      "calendar_name": "...",
      ...
    }
  }
  ```

#### `dateWindow` (optional)
Defines which events to include in the webhook payload.

**Smart Mode (Recommended):**
```json
{
  "mode": "smart",
  "futureMonths": 2
}
```
- Includes current month from day 1 + previous month's last week + N future months
- Example: If today is April 25, includes from ~March 25 through June 30
- Ensures month views always have complete data regardless of when webhook is called

**Sliding Mode:**
```json
{
  "mode": "sliding",
  "pastDays": 7,
  "futureDays": 60
}
```
- Simple offset from today: today - pastDays to today + futureDays
- Less robust for month views when webhook called late in the month

**Default:** `{ mode: "smart", futureMonths: 2 }`

## Configuration Examples

### Single Calendar

```json
[
  {
    "name": "Rental Reservations",
    "webhookUrl": "https://usetrmnl.com/api/custom_plugins/abc123",
    "sources": [
      {
        "icsPath": "../rental-calendar-sync/output/reservations-2026.ics",
        "label": "Rentals"
      }
    ]
  }
]
```

### Multiple Calendars Combined

```json
[
  {
    "name": "Complete Schedule",
    "webhookUrl": "https://usetrmnl.com/api/custom_plugins/xyz789",
    "sources": [
      {
        "icsPath": "../rental-calendar-sync/output/reservations-2026.ics",
        "label": "Rentals"
      },
      {
        "icsPath": "https://calendar.google.com/calendar/ical/you@gmail.com/basic.ics",
        "label": "Personal"
      },
      {
        "icsPath": "webcal://outlook.office365.com/owa/calendar/abc/def.ics",
        "label": "Work"
      }
    ],
    "dateWindow": {
      "mode": "smart",
      "futureMonths": 3
    }
  }
]
```

### Multiple Webhooks

```json
[
  {
    "name": "Living Room Display",
    "webhookUrl": "https://usetrmnl.com/api/custom_plugins/living-room",
    "sources": [
      {
        "icsPath": "~/calendars/family.ics",
        "label": "Family"
      },
      {
        "icsPath": "~/calendars/kids-sports.ics",
        "label": "Sports"
      }
    ]
  },
  {
    "name": "Office Display",
    "webhookUrl": "https://usetrmnl.com/api/custom_plugins/office",
    "sources": [
      {
        "icsPath": "../rental-calendar-sync/output/reservations-2026.ics",
        "label": "Properties"
      },
      {
        "icsPath": "webcal://work-calendar.com/cal.ics",
        "label": "Meetings"
      }
    ]
  }
]
```

## Payload Structure

The webhook receives JSON with the following structure:

```json
{
  "events": [
    {
      "uid": "event-123@example.com",
      "summary": "Team Meeting",
      "description": "Weekly sync",
      "status": "CONFIRMED",
      "location": "Conference Room A",
      "start": "2026-04-03T14:00:00.000Z",
      "end": "2026-04-03T15:00:00.000Z",
      "all_day": false,
      "start_date": "2026-04-03",
      "end_date": "2026-04-03",
      "source": "Work"
    }
  ],
  "calendar_name": "Complete Schedule",
  "sources": ["Rentals", "Personal", "Work"],
  "generated_at": "2026-04-03T20:30:00.000Z"
}
```

## Usage

### Basic Usage

```bash
npm start
```

### Dry Run (Print JSON without POSTing)

```bash
npm start -- --dry-run
```

### Custom Config File

```bash
npm start -- --config path/to/my-config.json
```

### Help

```bash
npm start -- --help
```

## Testing

Run the test suite to validate functionality:

```bash
npm test
```

The test suite covers:
- Basic event parsing (timed and all-day events)
- Recurring event expansion (weekly, daily, with limits)
- Timezone handling and local date preservation
- Date window filtering (smart and sliding modes)
- Event sorting
- Payload building
- Edge cases (empty calendars, missing fields, safety limits)

See [test/README.md](test/README.md) for detailed test documentation.

## How It Works

1. **Load config** from `config/webhooks.json`
2. **Iterate through each webhook** configuration
3. For each webhook:
   - Load all ICS files from `sources` array
   - Parse each ICS and extract events
   - Add `source` field to each event (label → X-WR-CALNAME → filename)
   - Combine all events into one array
   - Filter by date window (smart or sliding mode)
   - Sort by start time
   - Build payload with calendar name and sources
   - POST to webhook URL

## Source Label Priority

When determining the `source` label for each event:

1. **User-provided label** from config (if specified)
2. **X-WR-CALNAME** from the ICS file
3. **Filename** (for local files)

Example:
```json
{
  "icsPath": "calendars/vacation.ics",
  "label": "Vacation Time"  // This takes priority
}
```

## Date Window Examples

### Smart Mode - Early in Month (April 3)

```json
{
  "dateWindow": {
    "mode": "smart",
    "futureMonths": 2
  }
}
```

**Range:** March 25 - June 30
- Current month start: April 1
- Buffer: -7 days = March 25
- Future: +2 months = June 30

### Smart Mode - Late in Month (April 25)

**Same config, same result:** March 25 - June 30

All April events included! This is why smart mode is recommended.

### Sliding Mode (For Comparison)

```json
{
  "dateWindow": {
    "mode": "sliding",
    "pastDays": 7,
    "futureDays": 60
  }
}
```

**If called on April 25:**
- Range: April 18 - June 24
- ❌ Missing April 1-17 events

## Automation

### Cron Job

Add to crontab to run every hour:

```bash
0 * * * * cd /path/to/calendar-webhook && npm start >> /tmp/calendar-webhook.log 2>&1
```

### GitHub Actions

```yaml
name: Update Calendar Webhooks
on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm start
```

## Troubleshooting

### Config file not found

```
Error: Config file not found: config/webhooks.json
Create it from config/webhooks.example.json
```

**Solution:** Copy the example config:
```bash
cp config/webhooks.example.json config/webhooks.json
```

### Webhook POST failed

Check:
1. Webhook URL is correct
2. Network connectivity

## License

MIT

## Author

Jason Waters
