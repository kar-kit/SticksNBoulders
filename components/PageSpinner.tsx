/** Fills the available space with a centered spinner -- used while a page's auth/data is resolving, so navigating never shows a blank screen. */
export default function PageSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}
