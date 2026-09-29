"""Stable public endpoints for automation rules and recurring tasks: todobox.automation.<method>."""

from todobox.services.automation import (
	delete_recurring,
	delete_rule,
	get_automation,
	get_rule_fields,
	run_recurring_now,
	save_recurring,
	save_rule,
	toggle_recurring,
	toggle_rule,
)

__all__ = [
	"delete_recurring",
	"delete_rule",
	"get_automation",
	"get_rule_fields",
	"run_recurring_now",
	"save_recurring",
	"save_rule",
	"toggle_recurring",
	"toggle_rule",
]
