import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service | SLAB',
  description: 'Terms of Service for SLAB — AI-powered sales call transcription and analytics.',
}

export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12 prose prose-slate">
      <h1>Terms of Service</h1>
      <p>Last updated: March 17, 2026</p>
      <p>
        Please read these Terms of Service (&quot;Terms&quot;) carefully before using SLAB
        (&quot;the Service&quot;). By accessing or using the Service, you agree to be bound by these
        Terms. If you do not agree, do not use the Service. These Terms constitute a legally binding
        agreement between you and SLAB LLC (&quot;SLAB Training&quot;, &quot;We&quot;,
        &quot;Us&quot;, or &quot;Our&quot;).
      </p>

      <h2>1. Description of Service</h2>
      <p>
        SLAB is an AI-powered sales call transcription and analytics platform. The Service
        enables authorized users to record sales conversations, generate transcripts with automatic
        PII redaction, access training videos, and collaborate with their team through leaderboards,
        messaging, and performance insights.
      </p>

      <h2>2. Eligibility &amp; Account Access</h2>
      <p>
        Access to the Service is granted exclusively to authorized employees and representatives of
        companies that hold an active SLAB Training subscription. You must be at least 18 years old
        to use the Service. You are responsible for maintaining the confidentiality of your login
        credentials and for all activity that occurs under your account. You agree to notify us
        immediately of any unauthorized use of your account.
      </p>

      <h2>3. Recording Consent &amp; Legal Compliance</h2>
      <p>
        <strong>
          IMPORTANT: Recording laws vary by jurisdiction. Before recording any conversation, you are
          solely responsible for obtaining all legally required consents from all parties.
        </strong>
      </p>
      <p>
        Many jurisdictions require the consent of all parties to a conversation before it may be
        recorded (&quot;all-party consent&quot; or &quot;two-party consent&quot; laws). By using the
        recording feature, you represent and warrant that:
      </p>
      <ul>
        <li>You have obtained all required consents from all parties to the conversation.</li>
        <li>
          Your use of the recording feature is in full compliance with applicable federal, state,
          and local recording laws.
        </li>
        <li>
          You will not use the Service to record any conversation in violation of any applicable law.
        </li>
      </ul>
      <p>
        SLAB Training assumes no liability for your failure to comply with applicable recording laws.
        You agree to indemnify and hold harmless SLAB Training from any claims, damages, or penalties
        arising from your non-compliance.
      </p>

      <h2>4. Data &amp; Privacy</h2>
      <p>
        The Service processes audio recordings, transcripts, and associated metadata on behalf of
        your employer (the subscribing company). Personal information collected or generated through
        the Service is subject to the SLAB Training{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <p>
        PII redaction is performed automatically as a convenience feature; it does not guarantee the
        complete removal of all personal data from transcripts. You should not upload recordings that
        contain sensitive information beyond what is necessary for your legitimate sales activities.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
        <li>Record individuals without their legally required consent.</li>
        <li>Share your account credentials with any third party.</li>
        <li>Attempt to reverse-engineer, decompile, or tamper with the Service.</li>
        <li>Upload malicious content or attempt to circumvent security measures.</li>
        <li>Use the Service to harass, defame, or harm any individual.</li>
        <li>
          Scrape, crawl, or use automated means to access the Service without our prior written
          consent.
        </li>
      </ul>

      <h2>6. Intellectual Property</h2>
      <p>
        All content, features, and functionality of the Service — including software, design, text,
        graphics, and logos — are owned by SLAB Training and are protected by applicable intellectual
        property laws. Your use of the Service does not grant you any ownership rights. Transcripts
        and recordings generated through your use remain the property of the subscribing company.
      </p>

      <h2>7. AI-Generated Content</h2>
      <p>
        Transcripts and analyses produced by the Service are generated by artificial intelligence
        and may contain inaccuracies, omissions, or errors. They are provided for informational and
        training purposes only and should not be relied upon as verbatim or legally accurate records
        of any conversation.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF
        ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, OR NON-INFRINGEMENT. SLAB TRAINING DOES NOT WARRANT THAT THE SERVICE
        WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
      </p>

      <h2>9. Limitation of Liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, SLAB TRAINING SHALL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATING TO YOUR
        USE OF THE SERVICE, INCLUDING BUT NOT LIMITED TO DAMAGES ARISING FROM UNAUTHORIZED
        RECORDINGS, DATA BREACHES, OR TRANSCRIPT INACCURACIES. OUR TOTAL LIABILITY TO YOU FOR ANY
        CLAIM SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SERVICE IN THE TWELVE (12) MONTHS
        PRECEDING THE CLAIM.
      </p>

      <h2>10. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless SLAB Training and its officers, directors,
        employees, and agents from and against any claims, liabilities, damages, losses, and
        expenses (including reasonable legal fees) arising out of or in any way connected with your
        access to or use of the Service, your violation of these Terms, or your violation of any
        applicable law.
      </p>

      <h2>11. Termination</h2>
      <p>
        SLAB Training may suspend or terminate your access to the Service at any time, with or
        without notice, for conduct that violates these Terms or is otherwise harmful to other users,
        SLAB Training, or third parties. Upon termination, your right to use the Service ceases
        immediately. Provisions that by their nature should survive termination (including Sections
        6, 8, 9, 10, and 12) shall survive.
      </p>

      <h2>12. Governing Law &amp; Disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Idaho, United States, without regard to
        its conflict-of-law provisions. Any disputes arising under these Terms shall be resolved
        exclusively in the state or federal courts located in Twin Falls County, Idaho. You consent
        to personal jurisdiction in those courts.
      </p>

      <h2>13. Changes to Terms</h2>
      <p>
        SLAB Training reserves the right to modify these Terms at any time. Updated Terms will be
        posted on this page with a revised &quot;Last updated&quot; date. Your continued use of the
        Service after changes are posted constitutes your acceptance of the revised Terms.
      </p>

      <h2>Contact Us</h2>
      <p>If you have questions about these Terms, you can contact us:</p>
      <ul>
        <li>
          By email:{' '}
          <a href="mailto:duncan@slabtraining.com">duncan@slabtraining.com</a>
        </li>
        <li>
          By visiting our website:{' '}
          <a href="http://www.slabtraining.com" target="_blank" rel="noopener noreferrer">
            http://www.slabtraining.com
          </a>
        </li>
        <li>By phone: (208) 212-6891</li>
        <li>By mail: SLAB LLC, 2295 E 4078 N, Filer, ID 83328</li>
      </ul>
    </div>
  )
}
