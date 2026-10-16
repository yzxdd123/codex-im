const TEXT_COMMAND_HANDLER_METHODS = {
  stop: "handleStopCommand",
  bind: "handleBindCommand",
  where: "handleWhereCommand",
  inspect_message: "handleMessageCommand",
  help: "handleHelpCommand",
  unknown_command: "handleUnknownCommand",
  workspace: "handleWorkspacesCommand",
  switch: "handleSwitchCommand",
  remove: "handleRemoveCommand",
  send: "handleSendCommand",
  new: "handleNewCommand",
  model: "handleModelCommand",
  quota: "handleQuotaCommand",
  effort: "handleEffortCommand",
  approve: "handleApprovalCommand",
  reject: "handleApprovalCommand",
};

async function dispatchTextCommand(runtime, normalized) {
  const handlerMethod = TEXT_COMMAND_HANDLER_METHODS[normalized.command];
  if (!handlerMethod || typeof runtime[handlerMethod] !== "function") {
    return false;
  }

  await runtime[handlerMethod](normalized);
  return true;
}

module.exports = {
  dispatchTextCommand,
};

