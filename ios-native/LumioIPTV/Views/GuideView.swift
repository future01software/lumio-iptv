import Combine
import LumioCore
import Observation
import SwiftUI

/// Loads per-channel schedules on demand (rows appearing on screen, or a whole small
/// category up front) and remembers them for the guide's lifetime.
@MainActor
@Observable
final class GuideStore {
    private(set) var schedules: [String: [EPGProgram]] = [:]
    private var inFlight = Set<String>()

    func schedule(_ channel: Channel) -> [EPGProgram]? { schedules[channel.id] }

    func load(_ channel: Channel, model: AppModel) async {
        guard schedules[channel.id] == nil, inFlight.insert(channel.id).inserted else { return }
        defer { inFlight.remove(channel.id) }
        if let programs = await model.schedule(for: channel) { schedules[channel.id] = programs }
    }

    /// Prefetches a category so "hide channels without a schedule" can settle quickly.
    func preload(_ channels: [Channel], model: AppModel) async {
        let todo = channels.filter { schedules[$0.id] == nil }.prefix(300)
        await withTaskGroup(of: Void.self) { group in
            var running = 0
            for channel in todo {
                if running >= 6 { await group.next(); running -= 1 }
                group.addTask { await self.load(channel, model: model) }
                running += 1
            }
        }
    }
}

struct GuideView: View {
    let channels: [Channel]
    let title: String

    @Environment(AppModel.self) private var model
    @State private var store = GuideStore()
    @State private var windowStart = GuideView.defaultStart(for: Date())
    @State private var dragOffset: CGFloat = 0
    @State private var selected: GuideSelection?
    @State private var now = Date()

    private let ticker = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    static let channelColumn: CGFloat = 64
    static let pointsPerHour: CGFloat = 120
    static let rowHeight: CGFloat = 58

    var body: some View {
        GeometryReader { geo in
            let timelineWidth = max(120, geo.size.width - Self.channelColumn)
            let span = Double(timelineWidth / Self.pointsPerHour) * 3600
            VStack(spacing: 0) {
                toolbar
                ruler(width: timelineWidth, span: span)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(visibleChannels) { channel in
                            GuideRow(channel: channel, programs: store.schedule(channel), windowStart: shiftedStart,
                                     span: span, width: timelineWidth, now: now) { program in
                                selected = GuideSelection(channel: channel, program: program)
                            }
                            .task { await store.load(channel, model: model) }
                        }
                    }
                    .overlay(alignment: .topLeading) { nowLine(width: timelineWidth, span: span) }
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 20)
                        .onChanged { v in
                            if abs(v.translation.width) > abs(v.translation.height) { dragOffset = v.translation.width }
                        }
                        .onEnded { v in
                            defer { dragOffset = 0 }
                            guard abs(v.translation.width) > abs(v.translation.height) else { return }
                            let seconds = -Double(v.translation.width / Self.pointsPerHour) * 3600
                            shift(by: (seconds / 900).rounded() * 900)
                        })
            }
        }
        .background(Theme.surface)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(ticker) { now = $0 }
        .task(id: channels.map(\.id).count) {
            if channels.count <= 300 { await store.preload(channels, model: model) }
        }
        .sheet(item: $selected) { sel in
            ProgramSheet(selection: sel, now: now)
                .presentationDetents([.medium])
        }
    }

    private var shiftedStart: Date {
        windowStart.addingTimeInterval(-Double(dragOffset / Self.pointsPerHour) * 3600)
    }

    private var visibleChannels: [Channel] {
        guard AppSettings.shared.guideHideEmpty else { return channels }
        // Rows disappear once their schedule has loaded and turned out empty.
        return channels.filter { store.schedule($0).map { !$0.isEmpty } ?? true }
    }

    static func defaultStart(for date: Date) -> Date {
        // Half an hour before now, on a 30-minute boundary.
        let t = date.addingTimeInterval(-1800).timeIntervalSince1970
        return Date(timeIntervalSince1970: (t / 1800).rounded(.down) * 1800)
    }

    private func shift(by seconds: TimeInterval) {
        withAnimation(.easeInOut(duration: 0.25)) { windowStart = windowStart.addingTimeInterval(seconds) }
    }

    // MARK: Toolbar

    private var days: [Int] {
        let back = model.anyCatchup ? 3 : 1
        return Array(-back...1)
    }

    private func dayLabel(_ offset: Int) -> String {
        switch offset {
        case -1: return "Dün"
        case 0: return "Bugün"
        case 1: return "Yarın"
        default:
            let d = Calendar.current.date(byAdding: .day, value: offset, to: Date())!
            return d.formatted(.dateTime.weekday(.abbreviated).day())
        }
    }

    private var selectedDay: Int {
        Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()),
                                         to: Calendar.current.startOfDay(for: windowStart.addingTimeInterval(1800))).day ?? 0
    }

    private var toolbar: some View {
        VStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(days, id: \.self) { offset in
                        let active = offset == selectedDay
                        Button(dayLabel(offset)) { jump(toDay: offset) }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(active ? Theme.brand : Theme.surface2, in: Capsule())
                            .foregroundStyle(active ? .white : Color(white: 0.85))
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            HStack(spacing: 8) {
                guideButton("‹ 3s") { shift(by: -3 * 3600) }
                guideButton("Şimdi") {
                    withAnimation(.easeInOut(duration: 0.25)) { windowStart = Self.defaultStart(for: Date()) }
                }
                guideButton("3s ›") { shift(by: 3 * 3600) }
                Spacer()
                Toggle(isOn: hideEmptyBinding) {
                    Text("Akışı olanlar").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .fixedSize()
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 8)
    }

    private var hideEmptyBinding: Binding<Bool> {
        Binding(get: { AppSettings.shared.guideHideEmpty }, set: { AppSettings.shared.guideHideEmpty = $0 })
    }

    private func guideButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Theme.surface2, in: Capsule())
            .foregroundStyle(.white)
            .buttonStyle(.plain)
    }

    private func jump(toDay offset: Int) {
        let cal = Calendar.current
        let todayStart = Self.defaultStart(for: Date())
        let target: Date
        if offset == 0 {
            target = todayStart
        } else {
            // Same time of day on the chosen day; for past/future days start at 20:00 prime time.
            let day = cal.date(byAdding: .day, value: offset, to: cal.startOfDay(for: Date()))!
            target = cal.date(bySettingHour: 20, minute: 0, second: 0, of: day)!.addingTimeInterval(-1800)
        }
        withAnimation(.easeInOut(duration: 0.25)) { windowStart = target }
    }

    // MARK: Ruler and now line

    private func x(for date: Date, span: TimeInterval, width: CGFloat) -> CGFloat {
        CGFloat(date.timeIntervalSince(shiftedStart) / span) * width
    }

    private func ruler(width: CGFloat, span: TimeInterval) -> some View {
        let start = shiftedStart
        let first = Date(timeIntervalSince1970: (start.timeIntervalSince1970 / 1800).rounded(.up) * 1800)
        let ticks = stride(from: first.timeIntervalSince1970, to: start.addingTimeInterval(span).timeIntervalSince1970, by: 1800)
            .map { Date(timeIntervalSince1970: $0) }
        return HStack(spacing: 0) {
            Color.clear.frame(width: Self.channelColumn, height: 28)
            ZStack(alignment: .topLeading) {
                ForEach(ticks, id: \.self) { t in
                    Text(t.hourMinute)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.muted)
                        .fixedSize()
                        .offset(x: x(for: t, span: span, width: width) + 4, y: 6)
                    Rectangle().fill(Theme.border).frame(width: 1, height: 8)
                        .offset(x: x(for: t, span: span, width: width), y: 18)
                }
                let nx = x(for: now, span: span, width: width)
                if nx >= 0, nx <= width {
                    Text(now.hourMinute)
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.brand, in: Capsule())
                        .foregroundStyle(.white)
                        .fixedSize()
                        .offset(x: nx - 20, y: 2)
                }
            }
            .frame(width: width, height: 28, alignment: .topLeading)
            .clipped()
        }
        .frame(height: 28)
        .background(Theme.surface)
    }

    @ViewBuilder
    private func nowLine(width: CGFloat, span: TimeInterval) -> some View {
        let nx = x(for: now, span: span, width: width)
        if nx >= 0, nx <= width {
            Rectangle()
                .fill(Theme.brand)
                .frame(width: 2)
                .frame(maxHeight: .infinity)
                .offset(x: Self.channelColumn + nx - 1)
                .allowsHitTesting(false)
        }
    }
}

struct GuideSelection: Identifiable {
    let channel: Channel
    let program: EPGProgram
    var id: String { channel.id + "|" + String(program.start.timeIntervalSince1970) }
}

private struct GuideRow: View {
    let channel: Channel
    let programs: [EPGProgram]?
    let windowStart: Date
    let span: TimeInterval
    let width: CGFloat
    let now: Date
    let onSelect: (EPGProgram) -> Void

    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 0) {
            Button { model.play(channel) } label: {
                RemoteImage(url: channel.logo, placeholderText: channel.name, contentMode: .fit)
                    .padding(6)
                    .frame(width: GuideView.channelColumn - 8, height: GuideView.rowHeight - 10)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(alignment: .bottomTrailing) {
                        if channel.hasCatchup {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.system(size: 9, weight: .bold))
                                .padding(2)
                                .background(.black.opacity(0.6), in: Circle())
                        }
                    }
            }
            .buttonStyle(.plain)
            .frame(width: GuideView.channelColumn)
            .accessibilityLabel(channel.name)

            timeline
                .frame(width: width, height: GuideView.rowHeight)
                .clipped()
        }
        .frame(height: GuideView.rowHeight)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.surface2).frame(height: 1) }
    }

    private var windowEnd: Date { windowStart.addingTimeInterval(span) }

    @ViewBuilder
    private var timeline: some View {
        if let programs {
            let visible = programs.filter { $0.stop > windowStart && $0.start < windowEnd }
            if visible.isEmpty {
                emptyBar(programs.isEmpty ? "Yayın akışı yok" : "Bu saatlerde yayın bilgisi yok")
            } else {
                ZStack(alignment: .leading) {
                    ForEach(visible, id: \.start) { p in block(p) }
                }
                .frame(width: width, height: GuideView.rowHeight, alignment: .leading)
            }
        } else {
            emptyBar("")
                .redacted(reason: .placeholder)
        }
    }

    private func emptyBar(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Theme.muted.opacity(0.7))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .frame(height: GuideView.rowHeight - 10)
            .background(Theme.surface2.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 2)
    }

    private func block(_ p: EPGProgram) -> some View {
        let scale = width / CGFloat(span)
        let x0 = CGFloat(p.start.timeIntervalSince(windowStart)) * scale
        let x1 = CGFloat(p.stop.timeIntervalSince(windowStart)) * scale
        let isLive = p.start <= now && p.stop > now
        let isPast = p.stop <= now
        let blockWidth = max(4, x1 - x0 - 2)
        // Keep the title readable when the programme started before the visible edge.
        let textInset = max(0, -x0)
        return Button { onSelect(p) } label: {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(isLive ? Theme.surface3 : Theme.surface2)
                if isLive {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Theme.brand.opacity(0.18))
                        .frame(width: blockWidth * p.progress(at: now))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.title.isEmpty ? "—" : p.title)
                        .font(.caption.weight(isLive ? .semibold : .regular))
                        .lineLimit(1)
                    Text("\(p.start.hourMinute)–\(p.stop.hourMinute)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .padding(.leading, 8 + min(textInset, max(0, blockWidth - 16)))
                .padding(.trailing, 4)
            }
            .frame(width: blockWidth, height: GuideView.rowHeight - 10)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isLive ? Theme.brand.opacity(0.6) : .clear, lineWidth: 1))
            .opacity(isPast ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .offset(x: x0 + 1)
    }
}

private struct ProgramSheet: View {
    let selection: GuideSelection
    let now: Date
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let p = selection.program
        let isLive = p.start <= now && p.stop > now
        let canCatchup = p.stop <= now && selection.channel.hasCatchup && model.activeAccount?.kind == .xtream
        VStack(alignment: .leading, spacing: 12) {
            Text(selection.channel.name).font(.subheadline).foregroundStyle(Theme.muted)
            Text(p.title.isEmpty ? "Program" : p.title).font(.title2.bold())
            Text("\(p.start.formatted(.dateTime.weekday(.wide).day().month())) · \(p.start.hourMinute)–\(p.stop.hourMinute)")
                .font(.subheadline).foregroundStyle(Theme.muted)
            if isLive { ProgressBar(value: p.progress(at: now)) }
            if let summary = p.summary {
                ScrollView { Text(summary).font(.callout).foregroundStyle(Color(white: 0.85)) }
            }
            Spacer(minLength: 0)
            if isLive {
                Button { dismiss(); model.play(selection.channel) } label: {
                    Label("Canlı izle", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
            } else if canCatchup {
                Button { dismiss(); model.playCatchup(selection.channel, p) } label: {
                    Label("Geriye dönük izle", systemImage: "clock.arrow.circlepath").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2)
        .preferredColorScheme(.dark)
    }
}
