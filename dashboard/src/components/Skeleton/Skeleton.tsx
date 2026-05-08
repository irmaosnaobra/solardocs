import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

export default function Skeleton({ width = '100%', height = 16, radius = 6, className }: SkeletonProps) {
  return (
    <div
      className={`${styles.skeleton} ${className ?? ''}`}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

export function SkeletonStat() {
  return (
    <div className={styles.statCard}>
      <Skeleton width={36} height={36} radius={8} />
      <Skeleton width="60%" height={28} />
      <Skeleton width="80%" height={12} />
    </div>
  );
}

export function SkeletonStats({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.statsGrid}>
      {Array.from({ length: count }).map((_, i) => <SkeletonStat key={i} />)}
    </div>
  );
}
