import { useState, useRef, useEffect } from 'react';

interface DropdownSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DropdownSelect({ options, value, onChange, placeholder = 'Select...' }: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="select-wrapper" ref={wrapperRef}>
      <button
        className={`select-button ${isOpen ? 'open' : ''} ${value ? 'selected' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="select-button-label">
          {value || placeholder}
        </span>
        <div className="select-arrow"></div>
      </button>

      {isOpen && (
        <div className="select-options">
          {options.map((option, index) => (
            <button
              key={`${option}-${index}`}
              className={`select-option ${value === option ? 'selected' : ''}`}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
