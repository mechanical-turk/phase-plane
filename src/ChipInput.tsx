// --- Tiny chip+input control ---
export function ChipInput({
  label,
  value,
  onChange,
  placeholder,
  invalid = false,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  compact?: boolean; // smaller input height for constants
}) {
  const sizePad = compact ? "py-1 text-xs" : "py-2 text-sm";

  return (
    <div className="inline-flex items-stretch">
      <span
        className={[
          "flex items-center", // make label stretch to input height and center text
          "px-2",
          "rounded-l-lg",
          "bg-gray-100 text-gray-700",
          "border border-gray-300 border-r-0",
          compact ? "text-xs" : "text-sm",
        ].join(" ")}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={invalid}
        className={[
          "w-full",
          "font-mono",
          "border border-gray-300",
          "rounded-r-lg",
          "bg-white",
          "px-2",
          sizePad, // controls height; label stretches to match
          "focus:outline-none",
          "focus:ring-2",
          invalid
            ? "focus:ring-red-500 border-red-400"
            : "focus:ring-blue-500 border-gray-300",
          "placeholder:text-gray-400",
        ].join(" ")}
      />
    </div>
  );
}
