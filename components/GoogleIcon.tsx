import React from 'react';

interface GoogleIconProps {
  className?: string;
  size?: number;
}

const GoogleIcon: React.FC<GoogleIconProps> = ({ className, size = 20 }) => (
  <svg
    aria-hidden="true"
    className={className}
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path
      d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z"
      fill="#4285F4"
    />
    <path
      d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z"
      fill="#34A853"
    />
    <path
      d="M6.39 13.9A6.02 6.02 0 0 1 6.07 12c0-.66.11-1.3.32-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.97c1.47 0 2.79.51 3.82 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z"
      fill="#EA4335"
    />
  </svg>
);

export default GoogleIcon;
