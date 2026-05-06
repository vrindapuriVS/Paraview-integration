import React from 'react';

interface ParticleSystemProps {
  count?: number;
  color?: string;
}

export default function ParticleSystem({ count = 10, color = '#ffffff' }: ParticleSystemProps) {
  return (
    <div className="particle-system">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="floating-particle"
          style={{
            '--particle-color': color,
            '--particle-size': `${Math.random() * 3 + 1}px`,
            '--particle-x': `${Math.random() * 100}%`,
            '--particle-y': `${Math.random() * 100}%`,
            '--particle-delay': `${Math.random() * 5}s`,
            '--particle-duration': `${5 + Math.random() * 5}s`,
            opacity: Math.random() * 0.6 + 0.2,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}





