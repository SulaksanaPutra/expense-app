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
  it("supports variants, disabled, and loading states with aria-busy", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" size="md" onClick={onClick}>
        Save Expense
      </Button>,
    );

    const btn = screen.getByRole("button", { name: "Save Expense" });
    expect(btn).toHaveClass("rounded-pill", "bg-primary");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button variant="danger-soft" loading onClick={onClick}>
        Saving
      </Button>,
    );
    const loadingBtn = screen.getByRole("button", { name: "Saving" });
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveAttribute("aria-busy", "true");
    await user.click(loadingBtn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Input and SearchInput", () => {
  it("associates label, hint, and error via aria-invalid and aria-describedby", () => {
    const { rerender } = render(
      <Input label="Merchant" hint="Enter store name" prefix="$" />,
    );
    const input = screen.getByLabelText("Merchant");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("Enter store name");

    rerender(
      <Input
        label="Merchant"
        error="Merchant is required"
        value=""
        onChange={() => {}}
      />,
    );
    const invalidInput = screen.getByLabelText("Merchant");
    expect(invalidInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Merchant is required");
    expect(invalidInput).toHaveAccessibleDescription("Merchant is required");
  });

  it("renders shortcut badge when empty and clear button when populated", async () => {
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
  });
});

describe("Dialog and ConfirmDialog", () => {
  it("opens with sticky header/footer, traps focus, and closes on Escape and backdrop click", async () => {
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
    expect(screen.getByRole("heading", { name: "Add Expense" })).toBeInTheDocument();

    // Focus trap cycles between focusable elements inside dialog
    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    const descInput = screen.getByLabelText("Description");
    const doneBtn = screen.getByRole("button", { name: "Done" });
    expect([closeBtn, descInput, doneBtn]).toContain(document.activeElement);

    doneBtn.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeBtn);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(doneBtn);

    // Escape closes dialog
    fireEvent.keyDown(dialogEl!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clicking inside panel does NOT trigger backdrop close
    fireEvent.click(screen.getByText("Log a shared charge"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clicking backdrop (<dialog> itself) triggers close
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
  it("exposes role='switch', aria-checked, and toggles via click, Space, and Enter", async () => {
    const user = userEvent.setup();
    function SwitchHarness() {
      const [on, setOn] = React.useState(false);
      return (
        <Switch
          label="Simplify Group Debts"
          checked={on}
          onCheckedChange={setOn}
        />
      );
    }

    render(<SwitchHarness />);
    const sw = screen.getByRole("switch", { name: "Simplify Group Debts" });
    expect(sw).toHaveAttribute("aria-checked", "false");

    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");

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
              { value: "even", label: "Split Evenly" },
              { value: "pct", label: "By Percentage" },
              { value: "exact", label: "Exact Amounts" },
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
});

describe("Card, Badge, and Avatar", () => {
  it("applies 18px radius and hairline border on Card", () => {
    render(
      <Card data-testid="card">
        <CardTitle>Monthly Category Breakdown</CardTitle>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("rounded-[18px]", "bg-canvas", "border-hairline");
  });

  it("renders Badge / StatusPill with pill radius and semantic tones", () => {
    render(
      <div>
        <Badge tone="success" dot>
          Live Sync
        </Badge>
        <StatusPill tone="danger">Action Needed</StatusPill>
      </div>,
    );
    expect(screen.getByText("Live Sync")).toHaveClass("rounded-pill");
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
});

describe("Table and Pagination", () => {
  it("wraps Table inside overflow-x-auto and exposes aria-sort on sortable headers", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
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
          <TableRow>
            <TableCell>Oct 24</TableCell>
            <TableCell>Trader Joe&apos;s</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    const dateHeader = screen.getByRole("columnheader", { name: /Date/ });
    expect(dateHeader).toHaveAttribute("aria-sort", "descending");

    await user.click(within(dateHeader).getByRole("button"));
    expect(onSort).toHaveBeenCalledTimes(1);
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
  it("exposes role='progressbar' and aria-valuenow/min/max on both bar and ring", () => {
    render(
      <div>
        <ProgressBar label="Personal Share Cap" value={1420} min={0} max={1600} />
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
    expect(bars).toHaveLength(3);

    expect(bars[0]).toHaveAttribute("aria-valuenow", "1420");
    expect(bars[0]).toHaveAttribute("aria-valuemin", "0");
    expect(bars[0]).toHaveAttribute("aria-valuemax", "1600");

    expect(bars[2]).toHaveAttribute("aria-valuenow", "18");
    expect(bars[2]).toHaveAttribute("aria-valuemax", "100");
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
