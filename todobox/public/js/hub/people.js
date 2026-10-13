/* ToDoBox: recipient suggestions for the "New task" drawer (server-side search, never the full user list) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* initial "To" suggestions when opening a new task */
  loadComposeSuggest = async () => {
    const rows = await this.api.searchUsers('', []);
    this.setState({ composeSuggest: (rows || []).filter((u) => u && u.suggested).slice(0, 5) });
  };
});
