/**
 * The example households as a row of cards above the form. Choosing one
 * fills the form and shows its result at once: with the default measures
 * the answer is precomputed (public/data/household_presets.json), otherwise
 * it is calculated without a Calculate press.
 *
 * @param {Object} props
 * @param {Array<{title: string, examples: Array<{id, label, description}>}>} props.groups
 * @param {string|null} props.value - The example the form holds, while unedited
 * @param {(id: string) => void} props.onChoose
 */
export default function ExampleCards({ groups, value, onChoose }) {
  return (
    <section className="example-cards" aria-labelledby="example-cards-title">
      <h2 className="example-cards-title" id="example-cards-title">
        Start from an example
      </h2>
      <div className="example-cards-groups">
        {groups.map((group) => (
          <div key={group.title} className="example-cards-group" role="group" aria-label={group.title}>
            <p className="example-cards-group-title" aria-hidden="true">
              {group.title}
            </p>
            <div className="example-cards-row">
              {group.examples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="example-card"
                  aria-pressed={value === example.id}
                  onClick={() => onChoose(example.id)}
                >
                  <span className="example-card-name">{example.label}</span>
                  <span className="example-card-description">{example.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
