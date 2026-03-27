import { HTMLAttributes, ReactNode } from "react";

type BlockTone = "default" | "muted" | "accent";

type BlockCardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  tone?: BlockTone;
  interactive?: boolean;
};

const toneToClass: Record<BlockTone, string> = {
  default: "",
  muted: "block--muted",
  accent: "block--accent",
};

function joinClasses(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function BlockCard({
  as = "section",
  tone = "default",
  interactive = false,
  className,
  children,
  ...rest
}: BlockCardProps) {
  const Component = as;

  return (
    <Component
      className={joinClasses(
        "block",
        toneToClass[tone],
        interactive && "block--interactive",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

type BlockTitleProps = {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function BlockTitle({ icon, title, subtitle, action }: BlockTitleProps) {
  return (
    <div className="block-title-row">
      <div>
        <h2 className="block-title">
          {icon ? <span className="icon-chip">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <p className="block-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
