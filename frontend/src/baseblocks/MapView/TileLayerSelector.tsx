import { Layers } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./MapView.module.css";
import type { TileLayerOption } from "./tileLayers";

type Props = {
  layers: TileLayerOption[];
  selected: TileLayerOption;
  onChange: (layer: TileLayerOption) => void;
};

export const TileLayerSelector = ({ layers, selected, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest(`.${styles.layerButton}`)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={styles.layerSelector}>
      <button
        type="button"
        className={styles.layerButton}
        onClick={() => setOpen((o) => !o)}
        title="Select map layer"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
      >
        <Layers size={18} />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={listboxId}
          className={styles.layerPanel}
          role="listbox"
          aria-label="Map basemap"
        >
          {layers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              role="option"
              aria-selected={layer.id === selected.id}
              className={styles.layerOption}
              onClick={() => {
                onChange(layer);
                setOpen(false);
              }}
            >
              {layer.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
