import { useState } from "react";
import { getHealth } from "@/client-api/health";
import { SidebarFooter } from "@/components/ui/sidebar";
import styles from "./BuildHashFooter.module.css";

export const BuildHashFooter = () => {
  const frontendHash = (import.meta.env.VITE_BUILD_HASH as string | undefined) ?? "local";
  const [backendHash, setBackendHash] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const handleClick = async () => {
    if (backendHash !== null || fetching) return;
    setFetching(true);
    try {
      const data = await getHealth();
      setBackendHash(data.buildHash ?? "???");
    } catch {
      setBackendHash("???");
    } finally {
      setFetching(false);
    }
  };

  return (
    <SidebarFooter className={styles.footer}>
      <button type="button" className={styles.buildHashButton} onClick={handleClick}>
        {fetching || backendHash !== null ? (
          <p className={styles.buildHash}>
            Frontend&nbsp;#<span className={styles.buildHashValue}>{frontendHash.slice(0, 7)}</span>
          </p>
        ) : (
          <p className={styles.buildHash}>
            Build&nbsp;#<span className={styles.buildHashValue}>{frontendHash.slice(0, 7)}</span>
          </p>
        )}
        {(fetching || backendHash !== null) && (
          <p className={styles.buildHash}>
            Backend&nbsp;#
            <span className={styles.buildHashValue}>
              {fetching ? "…" : backendHash?.slice(0, 7)}
            </span>
          </p>
        )}
      </button>
    </SidebarFooter>
  );
};
