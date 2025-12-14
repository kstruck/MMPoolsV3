import React from 'react';

interface LogoProps {
  className?: string;
  height?: string;
}

export const Logo: React.FC<LogoProps> = ({ className = "", height = "h-12" }) => (
  <a href="/" className={`flex items-center ${className}`}>
    <img
      src="/mmp_logo.png"
      alt="March Melee Pools Logo"
      className={`${height} w-auto`}
    />
  </a>
);