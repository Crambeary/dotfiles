import EventKit
import Foundation

let event_store = EKEventStore()

func calendar_access_granted() -> Bool {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess:
        return true
    case .notDetermined:
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        event_store.requestFullAccessToEvents { request_granted, _ in
            granted = request_granted
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 30)
        return granted
    default:
        return false
    }
}

guard calendar_access_granted() else {
    print("ACCESS_DENIED")
    exit(2)
}

let now = Date()
let horizon = now.addingTimeInterval(24 * 60 * 60)
let disabled_calendar_preferences = UserDefaults(suiteName: "com.apple.iCal")?
    .dictionary(forKey: "DisabledCalendars")
let disabled_ids = Set(
    disabled_calendar_preferences?["MainWindow"] as? [String] ?? []
)
let calendars = event_store.calendars(for: .event).filter {
    !disabled_ids.contains($0.calendarIdentifier)
}
let predicate = event_store.predicateForEvents(
    withStart: now.addingTimeInterval(-24 * 60 * 60),
    end: horizon,
    calendars: calendars
)
let next_event = event_store.events(matching: predicate)
    .filter { !$0.isAllDay && $0.endDate > now }
    .sorted { $0.startDate < $1.startDate }
    .first

guard let event = next_event else {
    print("No meetings")
    exit(0)
}

let title = event.title.replacingOccurrences(of: "\n", with: " ")
if event.startDate <= now {
    print("Now · \(title)")
} else {
    let minutes_until = max(1, Int(ceil(event.startDate.timeIntervalSince(now) / 60)))
    if minutes_until < 60 {
        print("\(minutes_until)m · \(title)")
    } else {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        print("\(formatter.string(from: event.startDate)) · \(title)")
    }
}
