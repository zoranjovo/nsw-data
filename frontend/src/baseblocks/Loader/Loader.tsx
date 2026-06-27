import styles from "./Loader.module.css";

export interface LoaderProps {
  size?: number;
}

export const Loader = ({ size = 40 }: LoaderProps) => {
  return (
    <svg
      className={styles.container}
      viewBox="0 0 40 40"
      height={size}
      width={size}
      role="img"
      aria-label="Loading"
      style={
        {
          "--uib-size": `${size}px`,
        } as React.CSSProperties
      }
    >
      <title>Loading</title>
      <circle
        className={styles.track}
        cx="20"
        cy="20"
        r="17.5"
        pathLength={100}
        strokeWidth="5"
        fill="none"
      />
      <circle
        className={styles.car}
        cx="20"
        cy="20"
        r="17.5"
        pathLength={100}
        strokeWidth="5"
        fill="none"
      />
    </svg>
  );
};
