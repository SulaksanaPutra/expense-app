// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertBanner,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  Dialog,
  Dropdown,
  Input,
  MaterialIcon,
  Pagination,
  ProgressBar,
  ProgressRing,
  SearchInput,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
  TabPanel,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  ToastContainer,
  ToastProvider,
  useToast,
} from "@/components/ui";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("supports all required variants, sizes, disabled, and loading states with aria-busy", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" size="md" onClick={onClick}>
        Save Expense
      </Button>,
    );

    const btn = screen.getByRole("button", { name: "Save Expense" });
    expect(btn).toHaveClass("rounded-pill", "bg-primary", "h-10");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button variant="icon-circle" size="sm" aria-label="Refresh">
        R
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveClass(
      "rounded-full",
      "h-9",
      "w-9",
    );

    rerender(
      <Button variant="danger-soft" size="lg" loading onClick={onClick}>
        Saving
      </Button>,
    );
    const loadingBtn = screen.getByRole("button", { name: "Saving" });
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveAttribute("aria-busy", "true");
    expect(loadingBtn).toHaveClass("h-11");
    await user.click(loadingBtn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Input and SearchInput", () => {
  it("associates label, hint, and error via aria-invalid and aria-describedby and supports pill shape", () => {
    const { rerender } = render(
      <Input
        label="Merchant"
        hint="Enter store name"
        prefix="$"
        shape="pill"
        value=""
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Merchant");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("Enter store name");
    expect(input.parentElement).toHaveClass("rounded-pill");

    rerender(
      <Input
        label="Merchant"
        error="Merchant is required"
        disabled
        value=""
        onChange={() => {}}
      />,
    );
    const invalidInput = screen.getByLabelText("Merchant");
    expect(invalidInput).toHaveAttribute("aria-invalid", "true");
    expect(invalidInput.parentElement).toHaveClass("bg-surface-container-low");
    expect(screen.getByRole("alert")).toHaveTextContent("Merchant is required");
    expect(invalidInput).toHaveAccessibleDescription("Merchant is required");
  });

  it("renders shortcut badge when empty, clear button when populated, and clears on Escape", async () => {
    const user = userEvent.setup();
    function SearchHarness() {
      const [q, setQ] = React.useState("");
      return (
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ("")}
          shortcut="⌘K"
          placeholder="Search transactions..."
        />
      );
    }

    render(<SearchHarness />);
    expect(screen.getByText("⌘K")).toBeInTheDocument();

    const searchBox = screen.getByRole("searchbox");
    await user.type(searchBox, "Trader");
    expect(screen.queryByText("⌘K")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(searchBox).toHaveValue("");

    await user.type(searchBox, "Whole Foods");
    const clearBtn = screen.getByRole("button", { name: "Clear search" });
    await user.click(clearBtn);
    expect(searchBox).toHaveValue("");
  });
});

describe("Select and Dropdown", () => {
  const options = [
    { value: "all", label: "All Groups" },
    { value: "apt4b", label: "Apt 4B Roommates" },
    { value: "tahoe", label: "Tahoe Cabin Trip" },
  ];

  it("supports keyboard navigation and ARIA listbox/option semantics", async () => {
    const user = userEvent.setup();
    function SelectHarness() {
      const [val, setVal] = React.useState("all");
      return (
        <Select
          label="Active Group"
          variant="pill-select"
          options={options}
          value={val}
          onChange={setVal}
        />
      );
    }

    render(<SelectHarness />);
    const trigger = screen.getByRole("button", { name: /Active Group/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(trigger).toHaveTextContent("Apt 4B Roommates");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowDown}{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("filters options in searchable-select mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        aria-label="Select payer"
        variant="searchable-select"
        options={options}
        value="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Select payer/i }));
    const filterInput = screen.getByLabelText("Search options...");
    await user.type(filterInput, "Tahoe");

    const filtered = screen.getAllByRole("option");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toHaveTextContent("Tahoe Cabin Trip");

    await user.click(filtered[0]);
    expect(onChange).toHaveBeenCalledWith("tahoe");
  });

  it("renders Dropdown action-menu with menu/menuitem ARIA roles and keyboard nav", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <Dropdown
        triggerAriaLabel="Transaction actions"
        items={[
          { id: "edit", label: "Edit Expense", onSelect: onEdit },
          { id: "sep", separator: true },
          { id: "delete", label: "Delete", danger: true, onSelect: onDelete },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Transaction actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Opening with ArrowUp focuses last item, Escape closes and restores focus
    await user.keyboard("{ArrowUp}");
    const reopenedItems = screen.getAllByRole("menuitem");
    expect(reopenedItems[1]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("Dialog and ConfirmDialog", () => {
  it("opens with aria-modal, sticky header/footer, traps focus, and closes on Escape and backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { container } = render(
      <Dialog
        open
        onClose={onClose}
        title="Add Expense"
        description="Log a shared charge"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <Input label="Description" />
      </Dialog>,
    );

    const dialogEl = container.querySelector("dialog");
    expect(dialogEl).not.toBeNull();
    expect(dialogEl).toHaveAttribute("open");
    expect(dialogEl).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Add Expense" })).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    const descInput = screen.getByLabelText("Description");
    const doneBtn = screen.getByRole("button", { name: "Done" });
    expect([closeBtn, descInput, doneBtn]).toContain(document.activeElement);

    doneBtn.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeBtn);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(doneBtn);

    fireEvent.keyDown(dialogEl!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Log a shared charge"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(dialogEl!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ConfirmDialog renders danger action, autofocuses Cancel, and supports blockedReason", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Archive Group"
        description="This group will become read-only."
        confirmLabel="Archive"
        variant="danger"
      />,
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    const confirmBtn = screen.getByRole("button", { name: "Archive" });
    expect(cancelBtn).toHaveFocus();
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete Account"
        confirmLabel="Delete"
        variant="danger"
        blockedReason="You still have an unsettled net balance of $45.00."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Action Blocked");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});

describe("Switch", () => {
  it("exposes role='switch', aria-checked, semantic tones, and toggles via click, Space, and Enter", async () => {
    const user = userEvent.setup();
    function SwitchHarness() {
      const [on, setOn] = React.useState(false);
      return (
        <Switch
          label="Auto-include me in new expenses"
          tone="success"
          checked={on}
          onCheckedChange={setOn}
        />
      );
    }

    render(<SwitchHarness />);
    const sw = screen.getByRole("switch", {
      name: "Auto-include me in new expenses",
    });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveClass("bg-surface-chip-translucent");

    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveClass("bg-success");

    sw.focus();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "false");

    await user.keyboard("{Enter}");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("respects disabled and disabledReason", () => {
    const onChange = vi.fn();
    render(
      <Switch
        label="Notifications"
        checked={false}
        onCheckedChange={onChange}
        disabled
        disabledReason="Only group admins can edit this setting"
      />,
    );

    const sw = screen.getByRole("switch", { name: "Notifications" });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute("title", "Only group admins can edit this setting");
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SegmentedControl / Tabs", () => {
  it("renders tablist/tab with aria-selected and arrow-key navigation", async () => {
    const user = userEvent.setup();
    function TabsHarness() {
      const [tab, setTab] = React.useState<"even" | "pct" | "exact">("even");
      return (
        <div>
          <SegmentedControl
            ariaLabel="Split Method"
            variant="split-method"
            value={tab}
            onChange={setTab}
            options={[
              { value: "even", label: "Equal" },
              { value: "pct", label: "Percentage" },
              { value: "exact", label: "Exact" },
            ]}
          />
          <TabPanel active={tab === "even"}>Even panel</TabPanel>
          <TabPanel active={tab === "pct"}>Percentage panel</TabPanel>
          <TabPanel active={tab === "exact"}>Exact panel</TabPanel>
        </div>
      );
    }

    render(<TabsHarness />);
    const tablist = screen.getByRole("tablist", { name: "Split Method" });
    expect(tablist).toHaveClass("bg-surface-container-low");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");

    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Percentage panel")).toBeVisible();

    await user.keyboard("{End}");
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("supports radiogroup/radio semantics with aria-checked", async () => {
    const user = userEvent.setup();
    function RadioHarness() {
      const [mode, setMode] = React.useState<"equal" | "shares">("equal");
      return (
        <SegmentedControl
          role="radiogroup"
          ariaLabel="Default Split Mode"
          variant="pill-tabs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "equal", label: "Equal" },
            { value: "shares", label: "Shares" },
          ]}
        />
      );
    }

    render(<RadioHarness />);
    const group = screen.getByRole("radiogroup", { name: "Default Split Mode" });
    const radios = within(group).getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");

    radios[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
  });
});

describe("Card, Badge, Avatar, and MaterialIcon", () => {
  it("applies 18px radius, hairline border, and Stitch sub-card surface token on Card", () => {
    render(
      <div>
        <Card data-testid="card">
          <CardTitle>Monthly Category Breakdown</CardTitle>
        </Card>
        <Card variant="sub-card" data-testid="sub-card">
          Active Group
        </Card>
      </div>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("rounded-[18px]", "bg-canvas", "border-hairline");

    const subCard = screen.getByTestId("sub-card");
    expect(subCard).toHaveClass(
      "rounded-[18px]",
      "bg-surface-container-low",
      "border-hairline",
    );
  });

  it("renders Badge / StatusPill with pill radius, tabular-nums, and semantic tones", () => {
    render(
      <div>
        <Badge tone="success" dot>
          Settled
        </Badge>
        <StatusPill tone="danger">Action Needed</StatusPill>
      </div>,
    );
    expect(screen.getByText("Settled")).toHaveClass("rounded-pill", "tabular-nums");
    expect(screen.getByText("Action Needed")).toHaveClass("rounded-pill");
  });

  it("renders Avatar initials and AvatarStack overflow pill", () => {
    render(
      <div>
        <Avatar name="Samira Patel" />
        <AvatarStack
          max={2}
          members={[
            { id: "1", name: "Alex Rivera" },
            { id: "2", name: "Elena Rostova" },
            { id: "3", name: "Marcus Vance" },
            { id: "4", name: "Liam Chen" },
          ]}
        />
      </div>,
    );

    expect(screen.getByRole("img", { name: "Samira Patel" })).toHaveTextContent(
      "SP",
    );
    const stack = screen.getByRole("group", {
      name: /Alex Rivera, Elena Rostova, Marcus Vance, Liam Chen/,
    });
    expect(stack).toHaveTextContent("+2");
  });

  it("renders MaterialIcon with material-symbols-outlined class and optional accessible label", () => {
    render(
      <div>
        <MaterialIcon name="grid_view" size={20} data-testid="decorative-icon" />
        <MaterialIcon name="notifications" size={20} label="Notifications" />
      </div>,
    );

    const decorative = screen.getByTestId("decorative-icon");
    expect(decorative).toHaveClass("material-symbols-outlined");
    expect(decorative).toHaveAttribute("aria-hidden", "true");
    expect(decorative).toHaveTextContent("grid_view");

    const labeled = screen.getByRole("img", { name: "Notifications" });
    expect(labeled).toHaveClass("material-symbols-outlined");
  });
});

describe("Table and Pagination", () => {
  it("wraps Table in a 14px bordered overflow-x-auto frame, exposes aria-sort, and supports keyboard row clicks", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection="desc" onSort={onSort}>
              Date
            </TableHead>
            <TableHead>Merchant</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow onClick={onRowClick}>
            <TableCell>Nov 28</TableCell>
            <TableCell>Trader Joe&apos;s</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass(
      "overflow-x-auto",
      "rounded-[14px]",
      "border",
      "border-hairline",
    );
    const dateHeader = screen.getByRole("columnheader", { name: /Date/ });
    expect(dateHeader).toHaveAttribute("aria-sort", "descending");

    await user.click(within(dateHeader).getByRole("button"));
    expect(onSort).toHaveBeenCalledTimes(1);

    const dataRow = screen.getByText("Trader Joe's").closest("tr")!;
    dataRow.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("renders TableEmpty and Pagination with aria-current and boundary controls", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <>
        <Table>
          <TableBody>
            <TableEmpty colSpan={3} title="No expenses yet" />
          </TableBody>
        </Table>
        <Pagination
          currentPage={1}
          totalPages={3}
          totalItems={15}
          pageSize={5}
          itemLabel="transactions"
          onPageChange={onPageChange}
        />
      </>,
    );

    expect(screen.getByText("No expenses yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe("ProgressBar and ProgressRing", () => {
  it("exposes role='progressbar', aria-valuenow/min/max, and auto tone thresholds", () => {
    render(
      <div>
        <ProgressBar
          label="Personal Share Cap"
          value={80}
          min={0}
          max={100}
          tone="auto"
          showPercentage
        />
        <ProgressBar
          label="Over Budget"
          value={95}
          min={0}
          max={100}
          tone="auto"
        />
        <ProgressBar
          label="Category Breakdown"
          value={85}
          max={100}
          segments={[
            { id: "food", label: "Food", value: 38, color: "#10b981" },
            { id: "rent", label: "Rent", value: 32, color: "#3b82f6" },
          ]}
        />
        <ProgressRing label="Cloud storage quota" value={18} max={100} />
      </div>,
    );

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(4);

    expect(bars[0]).toHaveAttribute("aria-valuenow", "80");
    expect(bars[0].firstElementChild).toHaveClass("bg-warning");

    expect(bars[1]).toHaveAttribute("aria-valuenow", "95");
    expect(bars[1].firstElementChild).toHaveClass("bg-danger");

    expect(bars[3]).toHaveAttribute("aria-valuenow", "18");
    expect(bars[3]).toHaveAttribute("aria-valuemax", "100");
  });
});

describe("Toast and AlertBanner", () => {
  it("renders AlertBanner with semantic role and dismiss action", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <AlertBanner
        tone="warning"
        title="Receipt storage full"
        description="Expense will be logged without receipt."
        onDismiss={onDismiss}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Receipt storage full");
    await user.click(screen.getByRole("button", { name: "Dismiss alert" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders ToastContainer as aria-live region and supports pushing & dismissing toasts", async () => {
    const user = userEvent.setup();
    function ToastDemo() {
      const { pushToast } = useToast();
      return (
        <Button
          onClick={() =>
            pushToast({
              tone: "success",
              title: "Expense saved",
              description: "$120.00 split evenly",
              duration: 0,
            })
          }
        >
          Trigger Toast
        </Button>
      );
    }

    render(
      <ToastProvider>
        <ToastDemo />
      </ToastProvider>,
    );

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: "Trigger Toast" }));
    expect(within(region).getByText("Expense saved")).toBeInTheDocument();

    await user.click(
      within(region).getByRole("button", { name: "Close notification" }),
    );
    expect(within(region).queryByText("Expense saved")).not.toBeInTheDocument();
  });

  it("supports standalone ToastContainer dismissal", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <ToastContainer
        toasts={[
          {
            id: "t1",
            tone: "error",
            title: "Sync failed",
            duration: 0,
          },
        ]}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close notification" }));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });
});
