import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Universflow toast styling — dark glass, rose accents, mobile-safe positioning.
// Matches the rest of the app (Apple-Music bento + #FF2D55 rose system).
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-center"
      offset={16}
      duration={3500}
      visibleToasts={3}
      style={{ zIndex: 2147483000 }}
      icons={{
        success: (
          <span className="uf-toast-tick" aria-hidden>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
          </span>
        ),
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "uf-toast group flex items-start gap-3 w-full rounded-2xl px-4 py-3 text-[13.5px] font-medium " +
            "bg-[rgba(16,16,18,0.92)] text-white border border-white/[0.08] " +
            "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] backdrop-blur-xl " +
            "data-[type=success]:border-[rgba(52,211,153,0.35)] data-[type=success]:bg-[rgba(13,28,22,0.92)] " +
            "data-[type=error]:border-[rgba(255,45,85,0.45)] data-[type=error]:bg-[rgba(36,12,18,0.94)] " +
            "data-[type=warning]:border-[rgba(251,191,36,0.35)] data-[type=warning]:bg-[rgba(34,25,8,0.94)] " +
            "data-[type=info]:border-[rgba(255,255,255,0.10)]",
          title: "text-[13.5px] font-semibold leading-snug",
          description: "text-[12px] text-white/65 leading-snug mt-0.5",
          icon: "shrink-0 mt-[1px] [&_svg]:w-[18px] [&_svg]:h-[18px] " +
                "data-[type=success]:text-emerald-400 data-[type=error]:text-[#FF2D55] " +
                "data-[type=warning]:text-amber-400 data-[type=info]:text-white/80",
          actionButton:
            "ml-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold bg-[#FF2D55] text-white",
          cancelButton:
            "rounded-lg px-3 py-1.5 text-[12px] font-medium bg-white/[0.08] text-white/80",
          closeButton:
            "!bg-white/[0.06] !text-white/70 !border-white/10 hover:!bg-white/[0.12]",
        },
        style: {
          // Honor mobile safe-area when the OS bar overlaps the toast.
          marginTop: "env(safe-area-inset-top)",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
