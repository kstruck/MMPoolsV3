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
        ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : null;

    return (
        <div ref={ref} className="relative">
            <label className="text-xs text-slate-500 block mb-1">{label}</label>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between bg-slate-950 border rounded-lg p-2.5 text-sm transition-colors ${open ? 'border-indigo-500 ring-1 ring-indigo-500/30' : 'border-slate-700 hover:border-slate-600'}`}
            >
                <span className={displayValue ? 'text-white' : 'text-slate-600'}>{displayValue || placeholder}</span>
                <div className="flex items-center gap-1">
                    {value && (
                        <span onClick={e => { e.stopPropagation(); clear(); }} className="text-slate-500 hover:text-red-400 p-0.5 rounded"><X size={14} /></span>
                    )}
                    <Calendar size={14} className="text-slate-500" />
                </div>
            </button>

            {open && (
                <div className="absolute z-50 mt-2 left-0 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/60 p-4 w-[300px] animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Month Nav */}
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={prevMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400"><ChevronLeft size={16} /></button>
                        <span className="text-white text-sm font-bold">{MONTHS[viewMonth.month]} {viewMonth.year}</span>
                        <button onClick={nextMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400"><ChevronRight size={16} /></button>
                    </div>

                    {/* Day Headers */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {DAYS.map(d => (
                            <div key={d} className="text-center text-[10px] text-slate-600 font-bold py-1">{d}</div>
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
                                    className={`w-8 h-8 rounded-lg text-xs font-medium flex items-center justify-center transition-colors
                                        ${selected ? 'bg-indigo-600 text-white' : todayMark ? 'bg-slate-800 text-indigo-400 ring-1 ring-indigo-500/40' : 'text-slate-300 hover:bg-slate-800'}`}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>

                    {/* Time Picker */}
                    <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2">
                        <Clock size={14} className="text-slate-500" />
                        <select
                            value={hour}
                            onChange={e => setHour(Number(e.target.value))}
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm w-14 appearance-none text-center"
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                                <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <span className="text-slate-500 font-bold">:</span>
                        <select
                            value={minute}
                            onChange={e => setMinute(Number(e.target.value))}
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm w-14 appearance-none text-center"
                        >
                            {Array.from({ length: 60 }, (_, i) => i).map(m => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <div className="flex bg-slate-950 border border-slate-700 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setAmPm('AM')}
                                className={`px-2 py-1.5 text-xs font-bold ${amPm === 'AM' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            >AM</button>
                            <button
                                onClick={() => setAmPm('PM')}
                                className={`px-2 py-1.5 text-xs font-bold ${amPm === 'PM' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            >PM</button>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={confirm}
                            disabled={!selectedDate}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold py-2 rounded-lg transition-colors"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={clear}
                            className="px-3 text-xs text-slate-400 hover:text-red-400 font-bold py-2 rounded-lg border border-slate-700 hover:border-red-800 transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
