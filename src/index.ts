import * as core from '@actions/core'
import fs from 'fs'
import axios, { isAxiosError } from 'axios'
import eslintJsonReportToJs from './eslintJsonReportToJs.js'
import getAnalyzedReport from './getAnalyzedReport.js'
import openStatusCheck from './openStatusCheck.js'
import closeStatusCheck from './closeStatusCheck.js'
import addAnnotationsToStatusCheck from './addAnnotationsToStatusCheck.js'
import getPullRequestChangedAnalyzedReport from './getPullRequestChangedAnalyzedReport.js'
import addSummary from './addSummary.js'
import addComment from './addComment.js'
import constants from './constants.js'
const {
  reportFile,
  onlyChangedFiles,
  failOnError,
  failOnWarning,
  neutralOnWarning,
  markdownReportOnStepSummary,
  postComment,
} = constants

async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'ataylorme/eslint-annotate-action'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false) core.info('\u001b[32m✓ Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = { action: action || '' }
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      { timeout: 3000 },
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`)
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`)
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

async function run(): Promise<void> {
  await validateSubscription()
  core.info(`Starting analysis of the ESLint report ${reportFile.replace(/\n/g, ', ')}. Standby...`)

  try {
    const reportJS = await eslintJsonReportToJs(reportFile)
    const analyzedReport = onlyChangedFiles
      ? await getPullRequestChangedAnalyzedReport(reportJS)
      : getAnalyzedReport(reportJS)

    core.info(analyzedReport.summary)
    core.setOutput('summary', analyzedReport.summary)
    core.setOutput('errorCount', analyzedReport.errorCount)
    core.setOutput('warningCount', analyzedReport.warningCount)

    // Determine check conclusion
    let conclusion: 'success' | 'failure' | 'neutral'
    if (!analyzedReport.success) {
      conclusion = 'failure'
    } else if (neutralOnWarning && analyzedReport.warningCount > 0 && !failOnWarning) {
      conclusion = 'neutral'
    } else {
      conclusion = 'success'
    }

    const checkId = await openStatusCheck()
    await addAnnotationsToStatusCheck(analyzedReport.annotations, checkId)

    if (markdownReportOnStepSummary) {
      await addSummary(analyzedReport.markdown)
    }

    if (postComment) {
      await addComment(analyzedReport.markdown)
    }

    await closeStatusCheck(
      conclusion,
      checkId,
      analyzedReport.summary,
      markdownReportOnStepSummary ? analyzedReport.markdown : '',
    )

    if ((failOnWarning && analyzedReport.warningCount > 0) || (failOnError && analyzedReport.errorCount > 0)) {
      core.setFailed(
        `${analyzedReport.errorCount} ESLint error(s) and ${analyzedReport.warningCount} ESLint warning(s) found`,
      )
    }
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else {
      core.setFailed('An unexpected error occurred during ESLint report analysis.')
    }
  }

  core.info('ESLint report analysis complete.')
}

run()
