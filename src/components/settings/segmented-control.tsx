/** Segmented control for a small fixed set of choices (2-4 options). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabledOptions,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Options that render but can't be selected (e.g. kind is locked while editing an existing rule). */
  disabledOptions?: T[];
}) {
  return (
    <span className="stg-seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`stg-seg-btn${value === opt.value ? " stg-seg-btn--on" : ""}`}
          onClick={() => onChange(opt.value)}
          disabled={disabledOptions?.includes(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}
