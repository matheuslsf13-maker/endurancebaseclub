import { Children, cloneElement, isValidElement } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

function withStickyHead(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (isValidElement(child) && child.type === 'thead') {
      const thead = child as ReactElement<HTMLAttributes<HTMLTableSectionElement>>;
      const existing = thead.props.className ?? '';
      return cloneElement(thead, { className: `sticky top-0 z-10 bg-surface ${existing}`.trim() });
    }
    return child;
  });
}

export function Table({ className = '', children, ...rest }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border">
      <table className={`w-full min-w-max border-collapse text-left text-sm ${className}`} {...rest}>
        {withStickyHead(children)}
      </table>
    </div>
  );
}
