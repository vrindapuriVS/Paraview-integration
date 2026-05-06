import { ReactNode, useEffect, useRef } from "react";

type Props = {
  role: "user" | "assistant";
  text?: string;
  content?: ReactNode;
};

export default function MessageBubble({ role, text, content }: Props) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // #region agent log
  // Analytics calls disabled - service not available
  // useEffect(() => {
  //   if (bubbleRef.current && contentRef.current) {
  //     const bubbleEl = bubbleRef.current;
  //     const contentEl = contentRef.current;
  //     const computedBubble = window.getComputedStyle(bubbleEl);
  //     const computedContent = window.getComputedStyle(contentEl);
  //     
  //     fetch('http://127.0.0.1:7243/ingest/0ba0e33f-7a01-4591-b5cc-b9da946f99e0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MessageBubble.tsx:25',message:'MessageBubble rendered',data:{role,text:text?.substring(0,50),hasContent:!!content,className:bubbleEl.className,computedStyles:{borderRadius:computedContent.borderRadius,background:computedContent.background,color:computedContent.color,padding:computedContent.padding,fontSize:computedContent.fontSize}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  //   }
  // }, [role, text, content]);
  // #endregion

  return (
    <div ref={bubbleRef} className={`message-bubble ${role}`}>
      <div ref={contentRef} className="bubble-content">
        {content || text}
      </div>
      {role === "assistant" && text && !content && (
        <div className="message-actions">
          <button className="action-btn" title="Copy">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 3.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M3.5 5.5h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            </svg>
          </button>
          <button className="action-btn" title="Thumbs up">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 6.5V12M5 6.5H3.5C3 6.5 2.5 7 2.5 7.5v3c0 .5.5 1 1 1H5M5 6.5V4c0-.5.5-1 1-1h2.5c.5 0 1 .5 1 1v2.5M8 11.5h2.5c.5 0 1-.5 1-1v-3c0-.5-.5-1-1-1H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="action-btn" title="Thumbs down">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11 9.5V4M11 9.5h1.5c.5 0 1-.5 1-1v-3c0-.5-.5-1-1-1H11M11 9.5V12c0 .5-.5 1-1 1H7.5c-.5 0-1-.5-1-1V9.5M8 4.5H5.5c-.5 0-1 .5-1 1v3c0 .5.5 1 1 1H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="action-btn" title="Regenerate">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 0 1 10-4.243M14 8a6 6 0 0 1-10 4.243M2 8h3m9 0h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
