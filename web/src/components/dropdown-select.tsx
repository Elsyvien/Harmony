import { useState, useRef, useEffect } from 'react';

interface DropdownSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DropdownSelect({ options, value, onChange, placeholder = 'Select...' }: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rotations, setRotations] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        if (isOpen) {
          setIsOpen(false);
          setRotations((prev) => prev + 1);
        }
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setRotations((prev) => prev + 1);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen((open) => !open);
    setRotations((prev) => prev + 1);
  };

  return (
    <div className="select-wrapper" ref={wrapperRef}>
      <button
        className={`select-button ${isOpen ? 'open' : ''} ${value ? 'selected' : ''}`}
        onClick={handleToggle}
      >
        <span className="select-button-label">
          {value || placeholder}
        </span>
        <div className="select-arrow" style={{ transform: `rotate(${rotations * 180}deg)` }}></div>
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
                setRotations((prev) => prev + 1);
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
