'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './ChatWidget.module.css';

interface Message {
  role: 'user' | 'bot';
  text: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://solardocs-api-irmaosnaobra-aioros.vercel.app') + '/chat';
const WA_URL = 'https://wa.me/5534991360223';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: 'Oi! Sou a assistente do SolarDoc Pro. Como posso ajudar? 😊' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  function formatText(text: string) {
    return text.replace(/(https:\/\/wa\.me\/\S+)/g, `<a href="$1" target="_blank" rel="noopener" class="${styles.waLink}">💬 Falar no WhatsApp</a>`);
  }

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history }),
      });
      const data = await res.json();
      const reply = data.reply || 'Desculpe, tente novamente.';
      setMessages(prev => [...prev, { role: 'bot', text: reply }]);
      setHistory(prev => [
        ...prev.slice(-10),
        { role: 'user', content: msg },
        { role: 'assistant', content: reply },
      ]);
    } catch {
      setMessages(prev => [...prev, { role: 'bot', text: `Ocorreu um erro. [💬 Falar no WhatsApp](${WA_URL})` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={styles.fab}
        onClick={() => setOpen(o => !o)}
        title="Assistente SolarDoc"
        aria-label="Abrir chat"
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div className={styles.box}>
          <div className={styles.header}>
            <span>🤖 Assistente SolarDoc</span>
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className={styles.messages} ref={messagesRef}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.bot}`}
                dangerouslySetInnerHTML={{ __html: formatText(m.text) }}
              />
            ))}
            {loading && (
              <div className={`${styles.msg} ${styles.bot} ${styles.typing}`}>...</div>
            )}
          </div>

          <div className={styles.inputRow}>
            <input
              className={styles.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Digite sua dúvida..."
              maxLength={300}
              disabled={loading}
            />
            <button className={styles.sendBtn} onClick={send} disabled={loading || !input.trim()}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
