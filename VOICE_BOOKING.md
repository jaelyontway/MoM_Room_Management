# Voice booking: “Book me an appointment tonight for 1 hour deep tissue at 8pm”

## Can it work from phone or watch?

**Yes**, but the exact setup depends on where the user speaks:

| Device | How it can work |
|--------|------------------|
| **Phone (browser)** | User opens your voice booking page (e.g. `https://yourserver.com/static/voice_book.html`), taps “Speak”, says the full sentence. The page uses the **Web Speech API** to capture speech, sends it to your server, and uses **speech synthesis** to say back “Your appointment is booked.” Works in Chrome/Safari on iPhone/Android. Can be “Add to Home Screen” for an app-like icon. |
| **Apple Watch** | No full browser with mic in a practical way. Options: (1) **Companion phone app** – watch app sends a “start booking” intent to the phone, phone opens the voice page or app and listens; (2) **Native watchOS app** that uses Siri/on-device speech, then calls your API. Both require building an app. |
| **Samsung / Wear OS watch** | Same idea: either a **companion phone app** that does the voice capture and calls your API, or a **native watch app** with speech recognition that calls your API. |

So the **simplest path** that works today is: **phone browser** (or a phone app that wraps the same flow). Watch can later trigger the same flow on the phone or via a native app.

## What the system needs to do

1. **Capture speech**  
   Phone (or watch app) turns “Massage on Main, book me an appointment tonight for 1 hour deep tissue at 8pm” into text (Web Speech API or device speech-to-text).

2. **Understand the request**  
   Your backend (or a small NLU step) parses:
   - **When:** “tonight” + “8pm” → today’s date, 8:00 PM local time.
   - **What:** “1 hour deep tissue” → duration 60 minutes, service type “Deep Tissue” (or your Square catalog equivalent).

3. **Check Square and create booking**  
   - Call Square **Search Availability** for that time range and service (and location/team if needed).
   - If a slot is free, call Square **Create Booking** with start time, duration, service variation ID, team member or “any available”, and customer if known.
   - Return a clear success/failure and a short confirmation message.

4. **Speak the reply**  
   Device uses text-to-speech to say: “Your appointment is booked for tonight at 8 PM, one hour deep tissue,” or “That time isn’t available. The next slot is…” (and optionally offer to book that).

## What’s in this repo

- **`/static/voice_book.html`**  
  One-shot voice booking page for **phone (or desktop)**: user taps “Hold to speak” (or “Speak”), says the full sentence, and the page sends the transcript to your API and speaks back the server’s reply (e.g. “Your appointment is booked”).

- **`POST /api/voice-book`**  
  Accepts `{ "utterance": "book me an appointment tonight for 1 hour deep tissue at 8pm" }`.  
  Parses time/service/duration, resolves the service to your Square catalog, calls **Search Availability**, then **Create Booking**. Returns a message to speak back (e.g. "Your appointment is booked…").

When you’re ready to go live with Square, you’ll need:

- Square **Bookings API**: Search Availability + Create Booking (with the right OAuth scopes and, if applicable, Appointments Plus).
- Mapping from spoken service names (“deep tissue”, “couples”, “90 minute”) to your Square **catalog** service variation IDs and durations.
- Optional: customer ID (e.g. from “book for John” or a logged-in user) when creating the booking.

Then the same “say it on your phone → API → speak back” flow will book real appointments in Square.
