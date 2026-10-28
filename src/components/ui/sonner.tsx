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
      duration={1800}
      visibleToasts={1}
      style={{ zIndex: 2147483000 }}
      icons={{
        success: (
          <span className="uf-toast-tick uf-hud-big" aria-hidden>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
          </span>
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "uf-island",
          title: "uf-island-title",
          description: "uf-island-desc",
          icon: "uf-island-icon",
          content: "uf-island-content",
          actionButton: "uf-island-action",
          cancelButton: "uf-island-cancel",
          closeButton: "hidden",
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
