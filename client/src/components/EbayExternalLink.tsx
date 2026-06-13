import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { onEbayLinkClick } from '../utils/openEbayUrl';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> & {
  href: string;
  children: ReactNode;
};

/** User-facing eBay link: opens in system Edge on Raw Investor (Windows), else target=_blank. */
export const EbayExternalLink = ({ href, onClick, children, ...rest }: Props) => {
  const url = String(href || '').trim();
  if (!url) return <>{children}</>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        onEbayLinkClick(e, url);
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  );
};
