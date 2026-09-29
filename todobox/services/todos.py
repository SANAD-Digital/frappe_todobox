"""Tasks (ToDo): folders, listing, create, update, forward, snooze, comments."""

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate, now_datetime, today

from todobox.services.checklist import get_checklists, has_checklist_table, normalize_checklist, set_checklist
from todobox.services.common import (
	can,
	CHECKLIST_FIELD,
	MANAGER_ONLY_FIELDS,
	TEMPLATE_DOCTYPE,
	derive_subject,
	ensure_can_manage,
	get_direct_reports,
	get_task,
	is_system_manager,
	loads,
	short_subject,
	split_csv,
	todo_has,
)
from todobox.services.notifications import create_notification_log
from todobox.services.query import my_scope, query_conditions, query_values

# Optional ToDo columns (ToDoBox custom fields, or fields added by other apps) returned when present
OPTIONAL_COLUMNS = (
	"thread_id",
	"cc_users",
	"read_by",
	"snooze_until",
	"snooze_rule",
	"forwarded_from",
	"labels",
	"task_template",
	"day_order",
	"rule_applied",
	"subject",
	"gcrm_subject",
	"task_content",
)

# Fields update_todo may write (besides the virtual "read" and "custom_checklist" keys)
UPDATABLE_FIELDS = (
	"status",
	"priority",
	"date",
	"subject",
	"gcrm_subject",
	"description",
	"task_content",
	"labels",
	"cc_users",
	"snooze_until",
	"snooze_rule",
	"day_order",
	"task_template",
)

SORTS = {
	"due": "date ASC, modified DESC",
	"priority": "FIELD(priority, 'High', 'Medium', 'Low'), date ASC",
	"oldest": "creation ASC",
}


def _count(conditions, values):
	return frappe.db.sql("SELECT COUNT(*) FROM `tabToDo` WHERE " + " AND ".join(conditions), values)[0][0]


@frappe.whitelist()
def get_counts():
	"""Task counts for all folders plus the unread count."""
	values = query_values()
	me = values["me"]

	inbox = ["allocated_to = %(me)s", "status = 'Open'"]
	if todo_has("snooze_until"):
		inbox.append("(snooze_until IS NULL OR snooze_until <= %(now)s)")
	inbox_count = _count(inbox, values)
	if todo_has("read_by"):
		unread_count = _count([*inbox, "(read_by IS NULL OR read_by NOT LIKE %(me_like)s)"], values)
	else:
		unread_count = inbox_count

	reports = get_direct_reports(me)
	if reports:
		values["reports"] = tuple(reports)

	return {
		"inbox": inbox_count,
		"overdue": _count(["allocated_to = %(me)s", "status = 'Open'", "date < %(today)s"], values),
		"today": _count(["allocated_to = %(me)s", "status = 'Open'", "date = %(today)s"], values),
		"sent": _count(["assigned_by = %(me)s"], values),
		"fwd": _count(["forwarded_from = %(me)s"], values) if todo_has("forwarded_from") else 0,
		"cc": _count(["cc_users LIKE %(me_like)s"], values) if todo_has("cc_users") else 0,
		"snoozed": _count(["allocated_to = %(me)s", "snooze_until > %(now)s"], values)
		if todo_has("snooze_until")
		else 0,
		"done": _count(["(allocated_to = %(me)s OR assigned_by = %(me)s)", "status = 'Closed'"], values),
		"team": _count(["assigned_by = %(me)s", "allocated_to IN %(reports)s", "status = 'Open'"], values)
		if reports
		else 0,
		"inboxUnread": unread_count,
	}


def _folder_conditions(folder, conditions, values):
	me = values["me"]
	if folder == "inbox":
		conditions.append("allocated_to = %(me)s AND status = 'Open'")
		if todo_has("snooze_until"):
			conditions.append("(snooze_until IS NULL OR snooze_until <= %(now)s)")
	elif folder == "overdue":
		conditions.append("allocated_to = %(me)s AND status = 'Open' AND date < %(today)s")
	elif folder == "today":
		conditions.append("allocated_to = %(me)s AND status = 'Open' AND date = %(today)s")
	elif folder == "sent":
		conditions.append("assigned_by = %(me)s")
	elif folder == "fwd":
		conditions.append("forwarded_from = %(me)s" if todo_has("forwarded_from") else "1=0")
	elif folder == "cc":
		conditions.append("cc_users LIKE %(me_like)s" if todo_has("cc_users") else "1=0")
	elif folder == "snoozed":
		conditions.append("allocated_to = %(me)s AND snooze_until > %(now)s" if todo_has("snooze_until") else "1=0")
	elif folder == "done":
		conditions.append("(allocated_to = %(me)s OR assigned_by = %(me)s) AND status = 'Closed'")
	elif folder == "waiting":
		query_conditions("is:waiting", conditions, values)
	elif folder in ("__query", "all"):
		my_scope(conditions)
	elif folder == "team":
		reports = get_direct_reports(me)
		if reports:
			conditions.append("assigned_by = %(me)s AND allocated_to IN %(reports)s AND status = 'Open'")
			values["reports"] = tuple(reports)
		else:
			conditions.append("1=0")
	else:
		# unknown folder: never list other people's tasks
		my_scope(conditions)


def _quick_conditions(quick, conditions):
	if quick == "overdue":
		conditions.append("status = 'Open' AND date < %(today)s")
	elif quick == "today":
		conditions.append("date = %(today)s")
	elif quick == "week":
		conditions.append("date >= %(today)s AND date <= DATE_ADD(%(today)s, INTERVAL 7 DAY)")
	elif quick == "unread" and todo_has("read_by"):
		conditions.append("(read_by IS NULL OR read_by NOT LIKE %(me_like)s)")


def _reference_info(rows):
	"""{(doctype, name): (status, amount)} for the linked documents, one query per reference DocType."""
	by_type = {}
	for r in rows:
		if r.get("reference_type") and r.get("reference_name"):
			by_type.setdefault(r.reference_type, set()).add(r.reference_name)
	out = {}
	for doctype, names in by_type.items():
		try:
			columns = frappe.db.get_table_columns(doctype)
		except Exception:
			continue
		if "status" not in columns:
			continue
		has_total = "grand_total" in columns
		fields = ["name", "status", "docstatus"] + (["grand_total"] if has_total else [])
		for d in frappe.get_all(doctype, filters={"name": ["in", list(names)]}, fields=fields):
			status = d.status or ("Submitted" if d.docstatus == 1 else "Draft")
			amount = (
				frappe.format_value(d.grand_total, {"fieldtype": "Currency"})
				if has_total and d.grand_total is not None
				else None
			)
			out[(doctype, d.name)] = (status, amount)
	return out


def _threads(names):
	"""{todo_name: [comment rows]} in one query."""
	if not names:
		return {}
	fields = ["name", "reference_name", "comment_type", "comment_by", "content", "creation"]
	has_reply = frappe.db.has_column("Comment", "is_reply")
	if has_reply:
		fields.append("is_reply")
	out = {}
	for c in frappe.get_all(
		"Comment",
		filters={"reference_doctype": "ToDo", "reference_name": ["in", names]},
		fields=fields,
		order_by="creation asc",
	):
		kind = "reply" if has_reply and c.is_reply else ("comment" if c.comment_type == "Comment" else "event")
		out.setdefault(c.reference_name, []).append(
			{"id": c.name, "kind": kind, "user": c.comment_by, "html": c.content, "ts": str(c.creation)}
		)
	return out


def _attachments(names):
	"""{todo_name: [{name, url}]} in one query."""
	if not names:
		return {}
	out = {}
	for f in frappe.get_all(
		"File",
		filters={"attached_to_doctype": "ToDo", "attached_to_name": ["in", names]},
		fields=["attached_to_name", "file_name", "file_url"],
	):
		out.setdefault(f.attached_to_name, []).append(
			{"name": f.file_name or f.file_url, "url": f.file_url or ""}
		)
	return out


def _fetch_todos(conditions, values, order_by="modified DESC", limit=100):
	"""Runs the ToDo query and formats each row (with thread, checklist, attachments) for the UI."""
	me = values["me"]
	columns = set(frappe.db.get_table_columns("ToDo"))
	select = [
		"name",
		"description",
		"status",
		"priority",
		"date",
		"allocated_to",
		"assigned_by",
		"reference_type",
		"reference_name",
		"modified",
		"creation",
	] + [c for c in OPTIONAL_COLUMNS if c in columns]
	where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
	rows = frappe.db.sql(
		f"SELECT {', '.join(f'`{c}`' for c in select)} FROM `tabToDo`{where} ORDER BY {order_by} LIMIT {int(limit)}",
		values,
		as_dict=True,
	)

	names = [r.name for r in rows]
	checklists = get_checklists(names)
	threads = _threads(names)
	files = _attachments(names)
	refs = _reference_info(rows)
	today_str = values.get("today") or today()

	out = []
	for r in rows:
		raw_desc = r.get("description") or ""
		clean_text = frappe.utils.strip_html(raw_desc).strip()
		lines = [line.strip() for line in clean_text.split("\n") if line.strip()]
		subject = derive_subject(r, lines)
		read_by = r.get("read_by") or ""
		ref_status, ref_amount = refs.get((r.reference_type, r.reference_name), (None, None))

		thread = [
			{
				"id": "desc-1",
				"kind": "desc",
				"user": r.get("assigned_by") or me,
				"html": thread_desc_html(subject, r.get("task_content"), raw_desc),
				"ts": str(r.get("creation") or r.get("modified")),
			}
		] + threads.get(r.name, [])

		out.append(
			{
				"name": r.name,
				"thread_id": r.get("thread_id") or f"THR-{r.name}",
				"subject": subject,
				"description": "\n".join(lines[1:]) if len(lines) > 1 else clean_text,
				"allocated_to": r.get("allocated_to") or me,
				"assigned_by": r.get("assigned_by") or me,
				"cc_users": split_csv(r.get("cc_users")),
				"status": r.get("status") or "Open",
				"priority": r.get("priority") or "Medium",
				"date": str(r.get("date") or today_str),
				"reference_type": r.get("reference_type"),
				"reference_name": r.get("reference_name"),
				"ref_status": ref_status,
				"ref_amount": ref_amount,
				"labels": split_csv(r.get("labels")),
				"read": me in read_by if read_by else True,
				"snooze_until": str(r.get("snooze_until")) if r.get("snooze_until") else None,
				"snooze_rule": r.get("snooze_rule"),
				"forwarded_from": r.get("forwarded_from"),
				"custom_checklist": checklists.get(r.name, []),
				"task_template": r.get("task_template"),
				"day_order": r.get("day_order"),
				"rule_applied": r.get("rule_applied"),
				"attachments": files.get(r.name, []),
				"modified": str(r.get("modified") or r.get("creation")),
				"thread": thread,
			}
		)
	return out


@frappe.whitelist()
def list_todos(folder="inbox", quick="all", search="", label=None, sort="modified"):
	"""Lists ToDos by folder, quick filter, search query, label and sort (max 100)."""
	conditions, values = [], query_values()
	_folder_conditions(folder, conditions, values)
	_quick_conditions(quick, conditions)

	if label and todo_has("labels"):
		values["label_like"] = f"%{label}%"
		conditions.append("labels LIKE %(label_like)s")

	if search and search.strip():
		query_conditions(search, conditions, values)

	order_by = SORTS.get(sort, "modified DESC")

	return _fetch_todos(conditions, values, order_by)


@frappe.whitelist()
def get_todo(name):
	"""A single ToDo formatted like list_todos (only when the current user takes part in it)."""
	if not frappe.db.exists("ToDo", name):
		return None
	conditions, values = ["name = %(todo_name)s"], {**query_values(), "todo_name": name}
	my_scope(conditions)
	rows = _fetch_todos(conditions, values, limit=1)
	return rows[0] if rows else None


@frappe.whitelist()
def get_todo_folder(name):
	"""The folder a ToDo belongs to for the current user."""
	return get_todo_folders([name]).get(name, "inbox")


def get_todo_folders(names):
	"""{todo_name: folder} for the current user, in one query (missing ToDos are left out)."""
	names = [n for n in set(names or []) if n]
	if not names:
		return {}
	fields = ["name", "allocated_to", "assigned_by", "status", "date"] + [
		c for c in ("snooze_until", "cc_users", "forwarded_from") if todo_has(c)
	]
	rows = frappe.get_all("ToDo", filters={"name": ["in", names]}, fields=fields)
	me = frappe.session.user
	now, today_date = now_datetime(), getdate(today())
	return {r.name: _folder_of(r, me, now, today_date) for r in rows}


def _folder_of(todo, me, now, today_date):
	if todo.allocated_to == me:
		if todo.status == "Closed":
			return "done"
		if todo.get("snooze_until") and get_datetime(todo.snooze_until) > now:
			return "snoozed"
		if todo.date and getdate(todo.date) < today_date:
			return "overdue"
		return "inbox"
	if me in split_csv(todo.get("cc_users")):
		return "cc"
	if todo.get("forwarded_from") == me:
		return "fwd"
	if todo.assigned_by == me:
		return "sent"
	if todo.status == "Closed":
		return "done"
	return "inbox"


def _set_read(todo, me, read):
	"""Adds/removes me in read_by directly (no Version, no modified-timestamp conflict)."""
	if not todo_has("read_by"):
		return
	users = split_csv(todo.get("read_by"))
	if read == (me in users):
		return
	users = [*users, me] if read else [u for u in users if u != me]
	frappe.db.set_value("ToDo", todo.name, "read_by", ",".join(users), update_modified=False)
	frappe.db.commit()


@frappe.whitelist()
def update_todo(name, patch):
	"""Updates fields on a ToDo. Keys: read, custom_checklist and the fields in UPDATABLE_FIELDS."""
	patch = dict(loads(patch, {}) or {})
	me = frappe.session.user
	todo = frappe.get_doc("ToDo", name)
	if not frappe.has_permission("ToDo", "read", doc=todo):
		frappe.throw(_("You do not have access to this task"), frappe.PermissionError)

	if set(patch) == {"read"}:
		_set_read(todo, me, bool(patch["read"]))
		return {"status": "success", "name": name}

	if me not in (todo.allocated_to, todo.assigned_by) and not frappe.has_permission("ToDo", "write", doc=todo):
		frappe.throw(_("You can only change tasks assigned to you or by you"), frappe.PermissionError)

	if any(k in patch for k in MANAGER_ONLY_FIELDS):
		ensure_can_manage(todo)

	if "read" in patch:
		read = bool(patch.pop("read"))
		if todo_has("read_by"):
			users = split_csv(todo.get("read_by"))
			if read and me not in users:
				users.append(me)
			elif not read:
				users = [u for u in users if u != me]
			todo.read_by = ",".join(users)

	for key in ("labels", "cc_users"):
		if isinstance(patch.get(key), list):
			patch[key] = ",".join(patch[key])

	if "custom_checklist" in patch:
		steps = patch.pop("custom_checklist")
		if has_checklist_table():
			set_checklist(todo, normalize_checklist(steps))

	closing = patch.get("status") == "Closed" and todo.status != "Closed"

	meta = frappe.get_meta("ToDo")
	for key, value in patch.items():
		if key in UPDATABLE_FIELDS and meta.has_field(key):
			todo.set(key, value)

	todo.save(ignore_permissions=True)

	if closing and todo.assigned_by and todo.assigned_by != me:
		create_notification_log(
			for_user=todo.assigned_by,
			subject=_("Task completed: {0}").format(short_subject(todo, 40)),
			content=_("{0} completed and closed the task").format(me),
			document_type="ToDo",
			document_name=todo.name,
			from_user=me,
			notif_type="Assignment",
		)

	frappe.db.commit()
	return {"status": "success", "name": name}


def _participants(doc):
	return {u for u in (doc.allocated_to, doc.assigned_by, *split_csv(doc.get("cc_users"))) if u}


def _mention_targets(mentions, me):
	"""Enabled, existing users from a JSON list/str of emails (me, Guest and duplicates removed)."""
	try:
		emails = loads(mentions, []) or []
	except ValueError:
		emails = []
	if isinstance(emails, str):
		emails = [emails]
	emails = list(dict.fromkeys(e.strip() for e in emails if isinstance(e, str) and e.strip()))
	emails = [e for e in emails if e not in (me, "Guest")][:20]
	if not emails:
		return {}
	rows = frappe.get_all("User", filters={"name": ["in", emails], "enabled": 1}, fields=["name", "full_name"])
	names = {r.name: r.full_name or r.name for r in rows}
	return {e: names[e] for e in emails if e in names}


@frappe.whitelist()
def add_comment(name, kind="reply", html="", mentions=None):
	"""Adds a reply/comment (or an Info event) to a ToDo and notifies the other participants.
	`mentions` (JSON list of emails): each mentioned user gets a "Mention" notification and, when not a
	participant yet, is added to the task's CC so they can open it."""
	doc = get_task(name)
	me = frappe.session.user
	comment = doc.add_comment("Comment" if kind in ("reply", "comment") else "Info", html)
	if kind == "reply" and frappe.db.has_column("Comment", "is_reply"):
		comment.db_set("is_reply", 1, update_modified=False)

	clean_html = frappe.utils.strip_html(html or "").strip()
	mentioned = _mention_targets(mentions, me) if kind in ("reply", "comment") else {}

	if mentioned:
		participants = _participants(doc)
		newcomers = [u for u in mentioned if u not in participants]
		if newcomers and todo_has("cc_users"):
			cc = split_csv(doc.get("cc_users"))
			cc += [u for u in newcomers if u not in cc]
			frappe.db.set_value("ToDo", doc.name, "cc_users", ",".join(cc), update_modified=False)
			doc.cc_users = ",".join(cc)
		doc.add_comment("Info", _("Mentioned {0}").format(", ".join(mentioned.values())))
		sender = frappe.utils.get_fullname(me)
		subject = _("{0} mentioned you in: {1}").format(sender, short_subject(doc, 40))
		for user in mentioned:
			create_notification_log(
				for_user=user,
				subject=subject,
				content=clean_html or subject,
				document_type="ToDo",
				document_name=doc.name,
				from_user=me,
				notif_type="Mention",
				dedupe=False,
			)

	for user in _participants(doc) - {me} - set(mentioned):
		create_notification_log(
			for_user=user,
			subject=_("New reply on task: {0}").format(short_subject(doc, 40)),
			content=clean_html or _("New comment"),
			document_type="ToDo",
			document_name=doc.name,
			from_user=me,
			notif_type="Mention",
		)

	frappe.db.commit()
	return {"status": "success", "comment_name": comment.name, "mentioned": list(mentioned)}


def thread_desc_html(subject, task_content, raw_desc):
	"""Description bubble: subject + formatted details when present, else the raw description."""
	content = (task_content or "").strip()
	if content and frappe.utils.strip_html(content).strip():
		return f"<p><strong>{frappe.utils.escape_html(subject or '')}</strong></p>{content}"
	return raw_desc or subject


def compose_description(subject, body):
	"""Subject as first line, then the details (the details may be HTML from the text editor)."""
	subject = (subject or "").strip()
	body = (body or "").strip()
	if body and frappe.utils.strip_html(body).strip() == "" and "<img" not in body:
		body = ""
	if not body:
		return subject
	if "<" in body and ">" in body:
		return f"<p>{frappe.utils.escape_html(subject)}</p>{frappe.utils.sanitize_html(body)}"
	return f"{subject}\n\n{body}"


def _attach_uploads(file_names, todo_name):
	"""Links my unattached uploads to the task; files already attached (to an earlier recipient) are copied."""
	me = frappe.session.user
	for fname in file_names:
		f = frappe.db.get_value(
			"File", fname, ["name", "file_url", "file_name", "is_private", "owner", "attached_to_name"], as_dict=True
		)
		if not f or (f.owner != me and me != "Administrator"):
			continue
		if not f.attached_to_name:
			frappe.db.set_value("File", f.name, {"attached_to_doctype": "ToDo", "attached_to_name": todo_name})
			continue
		frappe.get_doc(
			{
				"doctype": "File",
				"file_url": f.file_url,
				"file_name": f.file_name,
				"is_private": f.is_private,
				"attached_to_doctype": "ToDo",
				"attached_to_name": todo_name,
			}
		).insert(ignore_permissions=True)


@frappe.whitelist()
def discard_upload(name):
	"""Deletes a file I uploaded for a task that was never created (not attached to anything)."""
	f = frappe.db.get_value("File", name, ["owner", "attached_to_name"], as_dict=True)
	if not f or f.attached_to_name or f.owner != frappe.session.user:
		return {"ok": 0}
	frappe.delete_doc("File", name, ignore_permissions=True)
	return {"ok": 1}


@frappe.whitelist()
def create_todos(
	to,
	cc=None,
	subject="",
	body="",
	priority="Medium",
	date=None,
	reference_type=None,
	reference_name=None,
	labels=None,
	checklist=None,
	template=None,
	attachments=None,
):
	"""Creates one ToDo per recipient in `to`, sharing a thread ID."""
	to = loads(to, []) or []
	cc = loads(cc, []) or []
	labels = loads(labels, []) or []
	attachments = [a for a in (loads(attachments, []) or []) if a]
	checklist = normalize_checklist(checklist) if has_checklist_table() else []
	if template and not frappe.db.exists(TEMPLATE_DOCTYPE, template):
		template = None

	me = frappe.session.user
	meta = frappe.get_meta("ToDo")
	thread_id = f"THR-{frappe.generate_hash(length=6).upper()}"
	description = compose_description(subject, body)
	task_content = (frappe.utils.sanitize_html(body) if "<" in body else body) if body else None

	optional = {
		"thread_id": thread_id,
		"cc_users": ",".join(cc) if cc else None,
		"labels": ",".join(labels) if labels else None,
		"task_template": template,
		"gcrm_subject": subject,
		"subject": subject,
		"task_content": task_content,
	}
	optional = {k: v for k, v in optional.items() if v is not None and meta.has_field(k)}

	created = []
	for recipient in to:
		todo = frappe.new_doc("ToDo")
		todo.update(
			{
				"description": description,
				"allocated_to": recipient,
				"assigned_by": me,
				"priority": priority,
				"date": date or today(),
				"status": "Open",
				**optional,
			}
		)
		if reference_type and reference_name:
			todo.reference_type = reference_type
			todo.reference_name = reference_name
		if checklist:
			set_checklist(todo, checklist)

		todo.insert(ignore_permissions=True)
		created.append(todo.name)
		if attachments:
			_attach_uploads(attachments, todo.name)

		if recipient != me:
			create_notification_log(
				for_user=recipient,
				subject=_("New task assigned to you: {0}").format(subject or todo.name),
				content=body or subject,
				document_type="ToDo",
				document_name=todo.name,
				from_user=me,
				notif_type="Assignment",
			)
		for user in cc:
			if user not in (me, recipient):
				create_notification_log(
					for_user=user,
					subject=_("You have been added as CC on task: {0}").format(subject or todo.name),
					content=body or subject,
					document_type="ToDo",
					document_name=todo.name,
					from_user=me,
					notif_type="Share",
				)

	frappe.db.commit()
	return {"status": "success", "names": created, "thread_id": thread_id}


# ------------------------------------------------------------------ forward
FORWARD_MODES = ("full", "delegate")


def _can_forward(todo, me):
	if me in (todo.allocated_to, todo.assigned_by) or is_system_manager(me):
		return True
	return frappe.has_permission("ToDo", "write", doc=todo)


def _validate_forward(original, to, mode, me):
	if mode not in FORWARD_MODES:
		frappe.throw(_("Invalid forward mode"))
	if not _can_forward(original, me):
		frappe.throw(_("You can only forward tasks assigned to you or by you"), frappe.PermissionError)
	if original.status != "Open":
		frappe.throw(_("Only open tasks can be forwarded"))
	if not to:
		frappe.throw(_("Choose a recipient"))
	if to == me:
		frappe.throw(_("You cannot forward a task to yourself"))
	user = frappe.db.get_value("User", to, ["enabled", "user_type"], as_dict=True)
	if not user or not user.enabled or user.user_type != "System User":
		frappe.throw(_("The recipient must be an active system user"))
	if to == original.allocated_to:
		frappe.throw(_("The task is already assigned to this user"))
	if todo_has("parent_todo") and frappe.db.exists(
		"ToDo", {"parent_todo": original.name, "allocated_to": to, "status": "Open"}
	):
		frappe.throw(_("This user already has an open forwarded copy of this task"))


def _share_reference(ref_type, ref_name, user):
	"""Like Frappe's assign-to: share the linked document with the recipient when they cannot read it."""
	if not (ref_type and ref_name) or not frappe.db.exists(ref_type, ref_name):
		return
	if can(ref_type, "read", doc=ref_name, user=user):
		return
	if frappe.get_system_settings("disable_document_sharing"):
		return
	frappe.share.add(ref_type, ref_name, user, flags={"ignore_share_permission": True}, notify=0)


@frappe.whitelist()
def forward_todo(name, to, mode="full", reason=""):
	"""full: my task is Cancelled and the recipient gets an open copy in the same thread.
	delegate: my task stays open and a parallel task is created that I follow from "Forwarded"."""
	me = frappe.session.user
	original = frappe.get_doc("ToDo", name)
	reason = (reason or "").strip()
	_validate_forward(original, to, mode, me)
	thread_id = original.get("thread_id") or f"THR-{original.name}"
	meta = frappe.get_meta("ToDo")

	fwd_doc = frappe.new_doc("ToDo")
	fwd_doc.update(
		{
			"description": original.description,
			"allocated_to": to,
			"assigned_by": me,
			"priority": original.priority,
			"date": original.date,
			"status": "Open",
			"reference_type": original.reference_type,
			"reference_name": original.reference_name,
		}
	)
	for row in original.get(CHECKLIST_FIELD) or []:
		fwd_doc.append(
			CHECKLIST_FIELD, {"step": row.step, "done": row.done, "done_by": row.done_by, "done_on": row.done_on}
		)
	for field in ("task_template", "labels"):
		if meta.has_field(field):
			fwd_doc.set(field, original.get(field))
	fallback_subject = derive_subject(original) or _("Forwarded Task")
	for field in ("subject", "gcrm_subject"):
		if meta.has_field(field):
			fwd_doc.set(field, original.get(field) or fallback_subject)
	for field, value in (("thread_id", thread_id), ("parent_todo", original.name), ("forwarded_from", me)):
		if meta.has_field(field):
			fwd_doc.set(field, value)
	if meta.has_field("thread_id") and not original.get("thread_id"):
		frappe.db.set_value("ToDo", original.name, "thread_id", thread_id, update_modified=False)

	fwd_doc.flags.ignore_todo_rules = True
	fwd_doc.insert(ignore_permissions=True)
	_share_reference(original.reference_type, original.reference_name, to)

	to_name = frappe.utils.get_fullname(to)
	mode_label = _("Full forward") if mode == "full" else _("Involve (Delegate)")
	event_msg = _("Task forwarded to {0} ({1})").format(to_name, mode_label)
	if reason:
		event_msg += "<br>" + _("Forward reason: {0}").format(frappe.utils.escape_html(reason))
	original.add_comment("Info", event_msg)
	fwd_doc.add_comment("Info", event_msg)

	if mode == "full":
		original.reload()
		original.status = "Cancelled"
		original.save(ignore_permissions=True)

	create_notification_log(
		for_user=to,
		subject=_("A task has been forwarded to you: {0}").format(short_subject(original, 60)),
		content=reason or original.description,
		document_type="ToDo",
		document_name=fwd_doc.name,
		from_user=me,
		notif_type="Assignment",
	)

	frappe.db.commit()
	return {"status": "success", "new_name": fwd_doc.name, "to_name": to_name}


# ------------------------------------------------------------------ snooze / remind
@frappe.whitelist()
def snooze_todo(name, until, rule=None):
	"""Snoozes a ToDo until the given datetime ('YYYY-MM-DD HH:mm[:ss]', system time zone):
	the client sends the exact date and time the user chose (no hour is assumed here)."""
	until = get_datetime(until).strftime("%Y-%m-%d %H:%M:%S")
	todo = get_task(name)
	if todo_has("snooze_until"):
		todo.snooze_until = until
	if todo_has("snooze_rule"):
		todo.snooze_rule = rule
	todo.add_comment("Info", _("Task snoozed until {0}").format(until))
	todo.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "success", "until": until}


@frappe.whitelist()
def unsnooze_todo(name):
	"""Cancels the snooze of a ToDo."""
	todo = get_task(name)
	if todo_has("snooze_until"):
		todo.snooze_until = None
	if todo_has("snooze_rule"):
		todo.snooze_rule = None
	todo.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "success"}


@frappe.whitelist()
def remind_todo(name, text=None):
	"""Reminds the assignee: a reply in the task thread + a Frappe notification."""
	todo = frappe.get_doc("ToDo", name)
	if not frappe.has_permission("ToDo", "read", doc=todo):
		frappe.throw(_("You do not have access to this task"), frappe.PermissionError)
	text = (text or "").strip() or _("Reminder: this task is still awaiting your reply")
	todo.add_comment("Comment", text)
	if todo.allocated_to and todo.allocated_to != frappe.session.user:
		create_notification_log(
			for_user=todo.allocated_to,
			subject=_("Reminder: {0}").format(derive_subject(todo.as_dict())),
			content=text,
			document_type="ToDo",
			document_name=todo.name,
			notif_type="Alert",
		)
	frappe.db.commit()
	return get_todo(name)


# ------------------------------------------------------------------ workflow (legacy endpoints)
@frappe.whitelist()
def get_workflow_items():
	"""Open Workflow Actions assigned directly to the current user."""
	if not frappe.db.exists("DocType", "Workflow Action"):
		return {"pending": [], "sent": [], "decisions": []}

	actions = frappe.get_all(
		"Workflow Action",
		filters={"user": frappe.session.user, "status": "Open"},
		fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
		order_by="creation desc",
	)
	by_type = {}
	for a in actions:
		by_type.setdefault(a.reference_doctype, set()).add(a.reference_name)
	owners = {}
	for doctype, names in by_type.items():
		for d in frappe.get_all(doctype, filters={"name": ["in", list(names)]}, fields=["name", "owner"]):
			owners[(doctype, d.name)] = d.owner

	return {
		"pending": [
			{
				"name": a.name,
				"doctype": a.reference_doctype,
				"docname": a.reference_name,
				"state": a.workflow_state,
				"owner": owners.get((a.reference_doctype, a.reference_name)),
				"creation": str(a.creation),
			}
			for a in actions
			if (a.reference_doctype, a.reference_name) in owners
		]
	}


@frappe.whitelist()
def apply_workflow_action(doctype, docname, action):
	"""Applies a workflow action (same permission checks as "Required actions")."""
	from todobox.services.workflow import apply_action

	apply_action(doctype, docname, action)
	return {"status": "success"}
