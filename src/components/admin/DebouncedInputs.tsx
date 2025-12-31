import React, { useState, useEffect } from 'react';

interface DebouncedInputProps {
    value: string;
    onChange: (val: string) => void;
    className?: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
}

/**
 * Debounced input component to fix cursor jumping issues.
 * Uses local state and syncs with parent after 500ms of no typing.
 */
export const DebouncedInput: React.FC<DebouncedInputProps> = ({
    value,
    onChange,
    className,
    placeholder,
    type = "text",
    disabled
}) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        const handler = setTimeout(() => {
            if (localValue !== value) {
                onChange(localValue);
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [localValue, value, onChange]);

    return (
        <input
            type={type}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            className={className}
            placeholder={placeholder}
            disabled={disabled}
        />
    );
};

interface DebouncedTextareaProps {
    value: string;
    onChange: (val: string) => void;
    className?: string;
    placeholder?: string;
}

/**
 * Debounced textarea component to fix cursor jumping issues.
 * Uses local state and syncs with parent after 500ms of no typing.
 */
export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({
    value,
    onChange,
    className,
    placeholder
}) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        const handler = setTimeout(() => {
            if (localValue !== value) {
                onChange(localValue);
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [localValue, value, onChange]);

    return (
        <textarea
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            className={className}
            placeholder={placeholder}
        />
    );
};
