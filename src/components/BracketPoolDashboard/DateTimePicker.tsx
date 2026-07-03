import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface DateTimePickerProps {
    value: number | undefined; // unix timestamp ms
    onChange: (ts: number | null) => void;
    label: string;
    placeholder?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const DateTimePicker: React.FC<DateTimePickerProps> = ({ value, onChange, label, placeholder = 'Select date & time' }) => {
    const [open, setOpen] = useState(false);
    const [viewMonth, setViewMonth] = useState(() => {
        const d = value ? new Date(value) : new Date();
        return { year: d.getFullYear(), month: d.getMonth() };
    });
    const [selectedDate, setSelectedDate] = useState<Date | null>(value ? new Date(value) : null);
    const [hour, setHour] = useState(() => value ? new Date(value).getHours() % 12 || 12 : 11);
    const [minute, setMinute] = useState(() => value ? new Date(value).getMinutes() : 59);
    const [amPm, setAmPm] = useState<'AM' | 'PM'>(() => value ? (new Date(value).getHours() >= 12 ? 'PM' : 'AM') : 'PM');
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay();
    const today = new Date();

    const prevMonth = () => {
        setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
    };
    const nextMonth = () => {
        setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
    };

    const selectDay = (day: number) => {
        const d = new Date(viewMonth.year, viewMonth.month, day);
        setSelectedDate(d);
    };

    const confirm = useCallback(() => {
        if (!selectedDate) return;
        const d = new Date(selectedDate);
        let h = hour;
        if (amPm === 'PM' && h !== 12) h += 12;
        if (amPm === 'AM' && h === 12) h = 0;
        d.setHours(h, minute, 0, 0);
        onChange(d.getTime());
        setOpen(false);
    }, [selectedDate, hour, minute, amPm, onChange]);

    const clear = () => {
        onChange(null);
        setSelectedDate(null);
        setOpen(false);
    };

    const isSelected = (day: number) => {
        if (!selectedDate) return false;
        return selectedDate.getDate() === day && selectedDate.getMonth() === viewMonth.month && selectedDate.getFullYear() === viewMonth.year;
    };

    const isToday = (day: number) => {
        return today.getDate() === day && today.getMonth() === viewMonth.month && today.getFullYear() === viewMonth.year;
    };

    const displayValue = value
        ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : null;

    // Members may be in other timezones — make the zone this picker operates in explicit
    const zoneLabel = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();

    return (
        <div ref={ref} className="relative">
            <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">{label}</label>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between bg-surface border rounded-lg p-2.5 text-sm font-body transition-colors ${open ? 'border-gold-500 ring-1 ring-gold-500/30' : 'border-line hover:border-gold-500'}`}
            >
                <span className={displayValue ? 'text-[color:var(--text)] num' : 'text-faint'}>{displayValue || placeholder}</span>
                <div className="flex items-center gap-1">
                    {value && (
                        <span onClick={e => { e.stopPropagation(); clear(); }} className="text-faint hover:text-brandred-600 p-0.5 rounded"><X size={14} /></span>
                    )}
                    <Calendar size={14} className="text-faint" />
                </div>
            </button>

            {open && (
                <div className="absolute z-50 mt-2 left-0 bg-card border border-line rounded-xl shadow-card-hover p-4 w-[300px] animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Month Nav */}
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={prevMonth} className="p-1 rounded hover:bg-surface text-muted"><ChevronLeft size={16} /></button>
                        <span className="text-[color:var(--text)] text-sm font-display font-bold uppercase num">{MONTHS[viewMonth.month]} {viewMonth.year}</span>
                        <button onClick={nextMonth} className="p-1 rounded hover:bg-surface text-muted"><ChevronRight size={16} /></button>
                    </div>

                    {/* Day Headers */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {DAYS.map(d => (
                            <div key={d} className="text-center text-[10px] text-faint font-display font-bold uppercase py-1">{d}</div>
                        ))}
                    </div>

                    {/* Day Grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDayOfWeek }, (_, i) => (
                            <div key={`empty-${i}`} />
                        ))}
                        {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = i + 1;
                            const selected = isSelected(day);
                            const todayMark = isToday(day);
                            return (
                                <button
                                    key={day}
                                    onClick={() => selectDay(day)}
                                    className={`w-8 h-8 rounded-lg text-xs font-medium num flex items-center justify-center transition-colors
                                        ${selected ? 'bg-gold-500 text-navy-900 font-bold' : todayMark ? 'bg-surface text-gold-600 ring-1 ring-gold-500/40' : 'text-muted hover:bg-surface'}`}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>

                    {/* Time Picker */}
                    <div className="mt-3 pt-3 border-t border-line flex items-center gap-2">
                        <Clock size={14} className="text-faint" aria-hidden="true" />
                        <select
                            value={hour}
                            onChange={e => setHour(Number(e.target.value))}
                            className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[color:var(--text)] num text-sm w-14 appearance-none text-center"
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                                <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <span className="text-faint font-bold">:</span>
                        <select
                            value={minute}
                            onChange={e => setMinute(Number(e.target.value))}
                            className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[color:var(--text)] num text-sm w-14 appearance-none text-center"
                        >
                            {Array.from({ length: 60 }, (_, i) => i).map(m => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <div className="flex bg-surface border border-line rounded-lg overflow-hidden">
                            <button
                                onClick={() => setAmPm('AM')}
                                className={`px-2 py-1.5 text-xs font-display font-bold ${amPm === 'AM' ? 'bg-gold-500 text-navy-900' : 'text-muted hover:text-[color:var(--text)]'}`}
                            >AM</button>
                            <button
                                onClick={() => setAmPm('PM')}
                                className={`px-2 py-1.5 text-xs font-display font-bold ${amPm === 'PM' ? 'bg-gold-500 text-navy-900' : 'text-muted hover:text-[color:var(--text)]'}`}
                            >PM</button>
                        </div>
                        <span className="text-[11px] font-bold text-faint ml-auto">{zoneLabel}</span>
                    </div>
                    <p className="text-[11px] text-faint mt-2">
                        Times are in your timezone ({zoneLabel}). Members see this deadline converted to theirs.
                    </p>

                    {/* Actions */}
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={confirm}
                            disabled={!selectedDate}
                            className="flex-1 bg-brandred-600 hover:bg-brandred-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-display font-bold uppercase tracking-[0.05em] py-2 rounded-lg transition-colors"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={clear}
                            className="px-3 text-xs text-muted hover:text-brandred-600 font-display font-bold uppercase tracking-[0.05em] py-2 rounded-lg border border-line hover:border-brandred-600/50 transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
