import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

function withMentionLinks(content: string) {
  return content.replace(/(^|[\s(])@([a-zA-Z0-9_]{2,32})/g, '$1[@$2](#mention:$2)');
}

export function MarkdownMessage(props: MarkdownMessageProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#mention:')) {
              return <span className="mention-token">{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withMentionLinks(props.content)}
      </ReactMarkdown>
    </div>
  );
}
