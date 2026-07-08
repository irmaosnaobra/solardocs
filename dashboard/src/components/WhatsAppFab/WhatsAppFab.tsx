'use client';

const WA_NUMBER = '5534998165040';
const WA_MESSAGE = 'Olá! Estou usando o SolarDoc Pro e preciso de ajuda.';

export default function WhatsAppFab() {
  const href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MESSAGE)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com suporte no WhatsApp"
      title="Suporte SolarDoc no WhatsApp"
      className="sd-whats-fab"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9998,
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: '#25D366',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 6px 24px rgba(37,211,102,0.45), 0 2px 6px rgba(0,0,0,0.2)',
        textDecoration: 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.08)';
        e.currentTarget.style.boxShadow = '0 8px 28px rgba(37,211,102,0.55), 0 2px 6px rgba(0,0,0,0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 6px 24px rgba(37,211,102,0.45), 0 2px 6px rgba(0,0,0,0.2)';
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="30"
        height="30"
        fill="#fff"
        aria-hidden="true"
      >
        <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.5 0 .2 5.3.2 11.84c0 2.08.55 4.12 1.6 5.92L0 24l6.4-1.67a11.83 11.83 0 0 0 5.64 1.43h.01c6.54 0 11.84-5.3 11.84-11.84 0-3.16-1.23-6.13-3.47-8.44ZM12.05 21.5h-.01a9.65 9.65 0 0 1-4.92-1.34l-.35-.21-3.79.99 1.01-3.7-.23-.38a9.6 9.6 0 0 1-1.48-5.13c0-5.31 4.32-9.63 9.64-9.63 2.58 0 5 1 6.82 2.83a9.55 9.55 0 0 1 2.82 6.82c0 5.32-4.32 9.63-9.63 9.63Zm5.28-7.21c-.29-.14-1.71-.84-1.97-.94-.27-.1-.46-.14-.66.14-.19.29-.76.94-.93 1.14-.17.19-.34.21-.63.07-.29-.14-1.22-.45-2.32-1.43-.86-.77-1.44-1.71-1.61-2-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.07-.14-.66-1.59-.9-2.18-.24-.57-.48-.49-.66-.5l-.56-.01c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38 0 1.4 1.02 2.76 1.16 2.95.14.19 2 3.05 4.85 4.27.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.71-.7 1.95-1.37.24-.67.24-1.25.17-1.37-.07-.12-.26-.19-.55-.34Z"/>
      </svg>
    </a>
  );
}
